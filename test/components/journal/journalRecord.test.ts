// Schema-level tests for the journal record (ADR-0005 §3). Journal lines are
// machine-written, so anything the schema would not have produced — wrong
// timestamp precision, a mangled run_id, an unknown key — is corruption and
// must be refused, never repaired or skipped.
import { describe, expect, it } from 'vitest'
import { journalRecordSchema } from '../../../src/components/journal/journalRecord.js'
import {
  issuePaths,
  minimalJournalRecord,
  requiredJournalRecordPaths,
  validJournalRecord,
  withFields,
  withoutField,
} from './fixtures.js'

describe('journalRecordSchema', () => {
  it('accepts the full fixture unchanged — no defaults, no transforms', () => {
    const result = journalRecordSchema.safeParse(validJournalRecord)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(validJournalRecord)
  })

  it('accepts the minimal record without injecting optional keys', () => {
    const result = journalRecordSchema.safeParse(minimalJournalRecord)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(minimalJournalRecord)
      expect('issue' in result.data).toBe(false)
      expect('data' in result.data).toBe(false)
    }
  })

  it('names every missing required field', () => {
    for (const field of requiredJournalRecordPaths) {
      const result = journalRecordSchema.safeParse(withoutField(validJournalRecord, field))

      expect(result.success, field).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain(field)
    }
  })

  it('rejects imprecise or non-UTC timestamps', () => {
    // The writer stamps exactly Date.toISOString() output — UTC with
    // milliseconds. Anything else was hand-edited or written by a different
    // producer, and the journal is the one place we refuse to guess.
    for (const broken of [
      '2026-10-11',
      '2026-10-11T09:03:12Z',
      '2026-10-11T09:03:12.482+00:00',
      '2026-10-11T09:03:12.482',
      'not a timestamp',
    ]) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { ts: broken }))

      expect(result.success, broken).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('ts')
    }
  })

  it('rejects run_ids outside the documented pattern', () => {
    for (const broken of ['261011T090312Z-A3F2', 'run/1', '261011T090312Z', '']) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { run_id: broken }))

      expect(result.success, broken).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('run_id')
    }
  })

  it('accepts the documented dotted-lowercase event forms', () => {
    for (const event of [
      'run.claimed',
      'triage.started',
      'triage.plan-posted',
      'label.applied',
      'journal.appended',
    ]) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { event }))

      expect(result.success, event).toBe(true)
      if (result.success) expect(result.data.event).toBe(event)
    }
  })

  it('rejects malformed event identifiers', () => {
    // The taxonomy is machine-written dotted-lowercase; 'needs-human' is a
    // GitHub *label*, not an event — pin that distinction here.
    for (const broken of [
      'runclaimed',
      'Run.claimed',
      'run.CLAIMED',
      'run.claimed.',
      'run..claimed',
      'needs-human',
      '',
    ]) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { event: broken }))

      expect(result.success, broken).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('event')
    }
  })

  it('rejects out-of-range or mistyped issue numbers, passes valid ones through', () => {
    for (const broken of [0, -1, 1.5, '42']) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { issue: broken }))

      expect(result.success, String(broken)).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('issue')
    }

    const valid = journalRecordSchema.safeParse(withFields(validJournalRecord, { issue: 1 }))
    expect(valid.success).toBe(true)
    if (valid.success) expect(valid.data.issue).toBe(1)
  })

  it('accepts arbitrary JSON values in data, rejects non-object data', () => {
    const richData = { nested: { ok: true }, list: [1, 2], none: null }
    const valid = journalRecordSchema.safeParse(withFields(validJournalRecord, { data: richData }))
    expect(valid.success).toBe(true)
    if (valid.success) expect(valid.data.data).toEqual(richData)

    for (const broken of ['flat', null, 42]) {
      const result = journalRecordSchema.safeParse(withFields(validJournalRecord, { data: broken }))

      expect(result.success, String(broken)).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('data')
    }
  })

  it('rejects unknown keys, naming them — machine-written lines only', () => {
    const edited = withFields(validJournalRecord, { actor: 'someone' })
    const result = journalRecordSchema.safeParse(edited)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('actor')
  })
})
