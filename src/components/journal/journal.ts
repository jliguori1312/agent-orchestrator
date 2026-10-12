// The journal itself (C14): an append-only JSONL audit trail, sharded by UTC
// month under the journal root (ADR-0005 §2). Writes validate the serialized
// line before touching disk; reads validate every line and fail on the first
// corrupt shard — silent gaps are indistinguishable from tampering, and the
// journal is the one record that must never be guessed at (SEC7).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ZodError } from 'zod'
import { JournalError } from './journalError.js'
import { journalRecordSchema, type JournalRecord } from './journalRecord.js'

// What a caller brings to the journal; the writer stamps `ts` itself so
// there is exactly one source of time.
export interface JournalEventInput {
  readonly run_id: string
  readonly event: string
  readonly issue?: number
  readonly data?: Record<string, unknown>
}

// The clock is injectable for deterministic tests; the default is the real
// one, and callers never pass timestamps of their own.
export interface JournalWriteOptions {
  readonly now?: () => Date
}

// One unreadable journal line: which shard, which line, why.
interface JournalReadFailure {
  readonly shardName: string
  readonly lineNumber: number
  readonly reason: string
}

export function appendJournalRecord(
  journalDirectory: string,
  input: JournalEventInput,
  options: JournalWriteOptions = {},
): void {
  const moment = (options.now ?? (() => new Date()))()
  const stampedRecord: Record<string, unknown> = {
    ts: moment.toISOString(),
    run_id: input.run_id,
    event: input.event,
  }
  if (input.issue !== undefined) stampedRecord.issue = input.issue
  if (input.data !== undefined) stampedRecord.data = input.data

  // Validate the *serialized* line, not the in-memory record: what lands on
  // disk is the string, so the string is what must pass the schema. A refused
  // write throws before any disk access — no directory, no partial line.
  const serializedLine = JSON.stringify(stampedRecord)
  const result = journalRecordSchema.safeParse(JSON.parse(serializedLine))
  if (!result.success) {
    throw new JournalError(
      `Refusing to append journal record at ${journalDirectory}: ${describeSchemaFindings(result.error)}`,
    )
  }

  // The shard is derived from the stamped timestamp's UTC month — ISO-8601's
  // fixed-width fields make the first seven characters exactly "YYYY-MM".
  const shardName = `${moment.toISOString().slice(0, 7)}.jsonl`

  // Owner-only permissions (ADR-0005 §8): the journal is the audit trail, and
  // group or world access on a shared host buys nothing. Modes apply at
  // creation only, which is exactly when they matter.
  mkdirSync(journalDirectory, { recursive: true, mode: 0o700 })
  appendFileSync(join(journalDirectory, shardName), `${serializedLine}\n`, { mode: 0o600 })
}

export function readJournal(journalDirectory: string): JournalRecord[] {
  // A missing journal is a fresh install, not corruption — distinct from a
  // malformed line, which must throw.
  if (!existsSync(journalDirectory)) return []

  // Zero-padded YYYY-MM shard names sort chronologically as plain strings,
  // which is what makes cross-shard reads come back in order.
  const shardNames = readdirSync(journalDirectory)
    .filter((entryName) => entryName.endsWith('.jsonl'))
    .sort()

  const records: JournalRecord[] = []
  const failures: JournalReadFailure[] = []
  for (const shardName of shardNames) {
    const shardText = readFileSync(join(journalDirectory, shardName), 'utf8')
    const shardLines = shardText.split('\n')

    for (const [lineIndex, shardLine] of shardLines.entries()) {
      // The writer always terminates its last line with a newline, so a
      // single trailing empty element is the writer's own format. An
      // interior blank line means the file was hand-edited: a gap in the
      // audit trail, refused below like any other corruption.
      const isTrailingNewline = lineIndex === shardLines.length - 1 && shardLine === ''
      if (isTrailingNewline) continue

      const lineNumber = lineIndex + 1
      let parsedLine: unknown
      try {
        parsedLine = JSON.parse(shardLine)
      } catch (parseFailure) {
        failures.push({ shardName, lineNumber, reason: describeFailure(parseFailure) })
        continue
      }

      const result = journalRecordSchema.safeParse(parsedLine)
      if (result.success) {
        records.push(result.data)
      } else {
        failures.push({ shardName, lineNumber, reason: describeSchemaFindings(result.error) })
      }
    }
  }

  // All-or-nothing (ADR-0005 §6): every problem in one error, never a silent
  // skip. Callers see the directory, the shard, and the line numbers.
  if (failures.length > 0) {
    const details = failures
      .map((failure) => `line ${failure.lineNumber} of ${failure.shardName}: ${failure.reason}`)
      .join('; ')
    throw new JournalError(`Cannot read journal at ${journalDirectory}: ${details}`)
  }

  return records
}

// Dot-joined path + message per finding — mirrors the config loader's
// formatting so both error styles read the same way in the systemd journal,
// without the journal reaching into the config component for it.
function describeSchemaFindings(zodError: ZodError): string {
  return zodError.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('; ')
}

// catch variables are unknown-typed; one narrowing helper keeps the loop
// above readable.
function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
