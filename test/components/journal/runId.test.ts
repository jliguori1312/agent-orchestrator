// Tests for run identity (ADR-0005 §1). The run_id embeds in worktree names
// (`agent-<issue>-<run_id>`) and HTML comment markers
// (`<!-- agent:run=<run_id> -->`, plan §6), so its charset is a safety
// property, not a style choice.
import { describe, expect, it } from 'vitest'
import { generateRunId, RUN_ID_PATTERN } from '../../../src/components/journal/runId.js'

describe('generateRunId', () => {
  it('produces the documented shape: UTC timestamp, dash, four lowercase hex', () => {
    const id = generateRunId(() => new Date('2026-10-11T09:03:12.482Z'))

    expect(RUN_ID_PATTERN.test(id)).toBe(true)
    // The full charset is digits, T, Z, the dash, and lowercase hex — nothing
    // else may ever appear, since the id is embedded in directory names and
    // HTML comments.
    expect(id).toMatch(/^[0-9a-fTZ-]+$/)
    expect(id).toHaveLength(19)
  })

  it('embeds the injected UTC timestamp at second resolution', () => {
    // Milliseconds are dropped: two clocks inside the same second must agree
    // on the timestamp prefix so the suffix is the only differentiator.
    const morning = generateRunId(() => new Date('2026-10-11T09:03:12.482Z'))
    const leapDayEve = generateRunId(() => new Date('2026-02-28T23:59:59.999Z'))

    expect(morning.startsWith('261011T090312Z-')).toBe(true)
    expect(leapDayEve.startsWith('260228T235959Z-')).toBe(true)
  })

  it('separates same-second starts through the random suffix', () => {
    const fixedClock = () => new Date('2026-10-11T09:03:12.482Z')
    const ids = Array.from({ length: 100 }, () => generateRunId(fixedClock))

    // All 100 share the timestamp prefix, so distinctness comes only from the
    // suffix. Requiring ≥50 distinct out of 100 makes a broken (constant)
    // suffix impossible to pass while never flaking on real randomness.
    expect(new Set(ids).size).toBeGreaterThanOrEqual(50)
  })

  it('sorts chronologically when compared as plain strings', () => {
    // Lexicographic order === chronological order is the whole reason for the
    // timestamp prefix (ADR-0005 §1); the year rollover is the case most
    // likely to break a hand-rolled formatter.
    const moments = [
      '2025-12-31T23:59:59Z',
      '2026-01-01T00:00:00Z',
      '2026-10-11T09:03:12Z',
      '2026-10-11T09:03:15Z',
    ]
    const ids = moments.map((moment) => generateRunId(() => new Date(moment)))

    expect([...ids].sort()).toEqual(ids)
  })

  it('rejects strings that would break worktree names or comment markers', () => {
    // Every rejected form is either unsafe to embed (slashes, spaces,
    // quotes, angle brackets) or a corruption of the format (uppercase hex,
    // missing Z, missing suffix, wrong suffix length, empty).
    for (const hostile of [
      'run/1',
      'agent 42',
      '"quoted"',
      '<!--',
      '261011T090312Z-A3F2',
      '261011T090312Z',
      '261011T090312-a3f2',
      '261011T090312Z-a3f',
      '',
    ]) {
      expect(RUN_ID_PATTERN.test(hostile), `pattern accepted: "${hostile}"`).toBe(false)
    }
  })

  it('generates pattern-valid ids with the default clock', () => {
    expect(RUN_ID_PATTERN.test(generateRunId())).toBe(true)
  })
})
