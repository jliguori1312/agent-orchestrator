// Boundary tests for the journal itself (ADR-0005 §2, §5, §6, §8): what lands
// on disk, in which shard, with which permissions — and the all-or-nothing
// read contract that makes the journal trustworthy as SEC7's audit trail.
// Filesystem boundary = a fresh temp directory per test, like the config
// loader tests; components take explicit paths so nothing needs injecting.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendJournalRecord, readJournal } from '../../../src/components/journal/journal.js'
import { JournalError } from '../../../src/components/journal/journalError.js'
import { validJournalRecord } from './fixtures.js'

describe('journal', () => {
  let scratchDirectory: string
  let journalDirectory: string

  // A fresh scratch dir per test; the journal root is usually *not* created
  // up front, because half the tests assert what happens when it is absent.
  beforeEach(() => {
    scratchDirectory = mkdtempSync(join(tmpdir(), 'agent-orchestrator-journal-'))
    journalDirectory = join(scratchDirectory, 'journal')
  })

  afterEach(() => {
    rmSync(scratchDirectory, { recursive: true, force: true })
  })

  // The injected clock is the same seam the implementation uses for
  // determinism; every fixed date below is UTC-anchored so shard math and
  // timestamps never depend on the runner's timezone.
  const octoberClock = () => new Date('2026-10-11T09:03:12.482Z')

  const claimInput = { run_id: '261011T090312Z-a3f2', event: 'run.claimed', issue: 42 }

  // Mirrors the config tests' captureConfigError: run `action`, insist the
  // failure is the component's own error type, and hand it back for message
  // assertions.
  function captureJournalError(action: () => unknown): JournalError {
    try {
      action()
      throw new Error('expected the action to throw JournalError')
    } catch (failure) {
      if (failure instanceof JournalError) return failure
      throw failure
    }
  }

  it('appends one schema-valid line stamped with the injected clock', () => {
    appendJournalRecord(journalDirectory, claimInput, { now: octoberClock })

    const shardPath = join(journalDirectory, '2026-10.jsonl')
    const shardText = readFileSync(shardPath, 'utf8')
    const shardLines = shardText.split('\n')

    // The writer's line format is JSON + a trailing newline, so a split
    // yields exactly the content lines plus one empty tail.
    expect(shardLines).toHaveLength(2)
    expect(shardLines[1]).toBe('')

    const writtenRecord: unknown = JSON.parse(shardLines[0] ?? '')
    expect(writtenRecord).toEqual({ ...claimInput, ts: '2026-10-11T09:03:12.482Z' })
  })

  it('passes the free-form data payload through untouched', () => {
    const triageInput = {
      run_id: '261011T090312Z-a3f2',
      event: 'triage.started',
      issue: 42,
      data: { label: 'agent-in-progress', tier: 2 },
    }
    appendJournalRecord(journalDirectory, triageInput, { now: octoberClock })

    expect(readJournal(journalDirectory)[0]?.data).toEqual({
      label: 'agent-in-progress',
      tier: 2,
    })
  })

  it('creates the journal directory when it does not exist', () => {
    const nestedRoot = join(journalDirectory, 'nested', 'deeper')
    appendJournalRecord(nestedRoot, claimInput, { now: octoberClock })

    expect(existsSync(join(nestedRoot, '2026-10.jsonl'))).toBe(true)
  })

  it('preserves append order within a shard', () => {
    const laterClock = () => new Date('2026-10-11T09:03:15.000Z')
    appendJournalRecord(journalDirectory, claimInput, { now: octoberClock })
    appendJournalRecord(journalDirectory, claimInput, { now: laterClock })

    const records = readJournal(journalDirectory)
    expect(records.map((record) => record.ts)).toEqual([
      '2026-10-11T09:03:12.482Z',
      '2026-10-11T09:03:15.000Z',
    ])
  })

  it('shards by UTC month at the boundary', () => {
    const octoberEve = () => new Date('2026-10-31T23:59:59.999Z')
    const novemberDawn = () => new Date('2026-11-01T00:00:00.000Z')
    appendJournalRecord(journalDirectory, claimInput, { now: octoberEve })
    appendJournalRecord(journalDirectory, claimInput, { now: novemberDawn })

    expect(existsSync(join(journalDirectory, '2026-10.jsonl'))).toBe(true)
    expect(existsSync(join(journalDirectory, '2026-11.jsonl'))).toBe(true)
  })

  it('reads shards in chronological order across files', () => {
    // Including a year rollover: zero-padded shard names must sort the same
    // way the timestamps do, or cross-shard reads come back interleaved.
    const clocks = [
      () => new Date('2025-12-31T23:59:59.999Z'),
      () => new Date('2026-01-01T00:00:00.000Z'),
      () => new Date('2026-10-31T23:59:59.999Z'),
      () => new Date('2026-11-01T00:00:00.000Z'),
      () => new Date('2027-01-05T12:00:00.000Z'),
    ]
    for (const clock of clocks) appendJournalRecord(journalDirectory, claimInput, { now: clock })

    const records = readJournal(journalDirectory)
    expect(records.map((record) => record.ts)).toEqual(clocks.map((clock) => clock().toISOString()))
  })

  it('returns an empty list for a missing or empty journal directory', () => {
    // A missing journal is a fresh install, not corruption — distinct from a
    // malformed line, which must throw.
    expect(readJournal(join(journalDirectory, 'never-created'))).toEqual([])
    expect(readJournal(journalDirectory)).toEqual([])
  })

  it('ignores files that are not journal shards', () => {
    // Retention tooling may drop notes or lockfiles next to the shards; they
    // are not journal lines and must not break reads.
    mkdirSync(journalDirectory, { recursive: true })
    writeFileSync(join(journalDirectory, 'README.md'), 'retention notes\n', 'utf8')
    appendJournalRecord(journalDirectory, claimInput, { now: octoberClock })

    expect(readJournal(journalDirectory)).toHaveLength(1)
  })

  it('refuses to write a record the schema would reject, touching no disk', () => {
    const badEvent = { ...claimInput, event: 'runclaimed' }
    const eventFailure = captureJournalError(() =>
      appendJournalRecord(journalDirectory, badEvent, { now: octoberClock }),
    )
    expect(eventFailure.message).toContain('event')
    expect(eventFailure.message).toContain(journalDirectory)

    const badRunId = { ...claimInput, run_id: 'run/1' }
    const runIdFailure = captureJournalError(() =>
      appendJournalRecord(journalDirectory, badRunId, { now: octoberClock }),
    )
    expect(runIdFailure.message).toContain('run_id')

    // Validation happens before any disk access: a refused write must not
    // even create the directory.
    expect(existsSync(journalDirectory)).toBe(false)
  })

  it('aggregates every corrupt line into one read failure', () => {
    // These fixture tests bypass the writer, so the shard directory has to
    // exist before the raw file lands in it.
    mkdirSync(journalDirectory, { recursive: true })
    const shardPath = join(journalDirectory, '2026-10.jsonl')
    writeFileSync(
      shardPath,
      ['this line is not json', JSON.stringify(validJournalRecord), 'neither is this one'].join('\n') +
        '\n',
      'utf8',
    )

    const readFailure = captureJournalError(() => readJournal(journalDirectory))
    expect(readFailure.message).toContain(journalDirectory)
    expect(readFailure.message).toContain('2026-10.jsonl')
    expect(readFailure.message).toContain('line 1')
    expect(readFailure.message).toContain('line 3')
    expect(readFailure.message).not.toContain('line 2')
  })

  it('rejects a schema-invalid line, naming the field and the line', () => {
    mkdirSync(journalDirectory, { recursive: true })
    const shardPath = join(journalDirectory, '2026-10.jsonl')
    const missingEvent = { ts: validJournalRecord.ts, run_id: validJournalRecord.run_id }
    writeFileSync(shardPath, `${JSON.stringify(missingEvent)}\n`, 'utf8')

    const readFailure = captureJournalError(() => readJournal(journalDirectory))
    expect(readFailure.message).toContain('line 1')
    expect(readFailure.message).toContain('event')
  })

  it('rejects an interior blank line but tolerates the trailing newline', () => {
    // The writer always terminates its last line with \n — a trailing empty
    // line is the writer's own format. An interior blank line means the file
    // was edited by hand: a silent gap in the audit trail.
    mkdirSync(journalDirectory, { recursive: true })
    const shardPath = join(journalDirectory, '2026-10.jsonl')
    const laterRecord = { ...validJournalRecord, ts: '2026-10-11T09:03:15.000Z' }
    writeFileSync(
      shardPath,
      [JSON.stringify(validJournalRecord), '', JSON.stringify(laterRecord)].join('\n') + '\n',
      'utf8',
    )

    const readFailure = captureJournalError(() => readJournal(journalDirectory))
    expect(readFailure.message).toContain('line 2')
  })

  it('creates the journal directory and shards owner-only', () => {
    // The journal is the audit trail (SEC7); group or world access on a
    // shared host is sloppy and buys nothing.
    appendJournalRecord(journalDirectory, claimInput, { now: octoberClock })

    expect(statSync(journalDirectory).mode & 0o777).toBe(0o700)
    expect(statSync(join(journalDirectory, '2026-10.jsonl')).mode & 0o777).toBe(0o600)
  })
})
