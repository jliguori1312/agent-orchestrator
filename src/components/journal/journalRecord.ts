// Schema for one journal line (ADR-0005 §3). Journal lines are machine-
// written, so anything the writer would not have produced — imprecise
// timestamps, a mangled run_id, an unknown key — is corruption and must be
// refused on both the write and the read path, never repaired or skipped.
import { z } from 'zod'
import { strictObjectNamingTypos } from '../../shared/schemaPrimitives.js'
import { RUN_ID_PATTERN } from './runId.js'

// Exactly what Date.toISOString() produces: UTC, millisecond precision. The
// writer stamps this form and nothing else, so a line carrying anything
// different was hand-edited or written by a foreign producer.
const isoUtcWithMilliseconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

// The event taxonomy is an open set of dotted-lowercase identifiers
// (`run.claimed`, `triage.plan-posted`) until real event producers exist and
// it can be tightened to a closed enum (ADR-0005 §4). Note that a bare
// `needs-human` fails on purpose — that is a GitHub *label*, not an event.
const dottedLowercaseEvent = /^[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/

export const journalRecordSchema = strictObjectNamingTypos({
  ts: z.string().regex(isoUtcWithMilliseconds, {
    error: 'must be an ISO-8601 UTC timestamp with milliseconds',
  }),
  run_id: z.string().regex(RUN_ID_PATTERN, { error: 'must match the run id pattern' }),
  event: z.string().regex(dottedLowercaseEvent, {
    error: 'must be a dotted-lowercase event identifier',
  }),
  issue: z.number().int().positive().optional(),
  // Free-form per-event payload; JSON-representability is the caller's
  // contract (ADR-0005 §7) — JSON.stringify drops what it cannot encode, and
  // the writer's line validation cannot detect that.
  data: z.record(z.string(), z.unknown()).optional(),
})

export type JournalRecord = z.infer<typeof journalRecordSchema>
