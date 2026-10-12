// Tests for the run-marker comment (plan §6). The marker is the claim's
// idempotency token, so parsing must be strict: a malformed marker is not a
// marker, and the newest marker wins across a thread.
import { describe, expect, it } from 'vitest'
import {
  extractRunId,
  latestRunMarker,
  markerFor,
} from '../../../src/components/registry/runMarker.js'
import { OTHER_RUN_ID, RUN_ID } from './fixtures.js'

describe('run markers', () => {
  it('round-trips a run id through the marker', () => {
    expect(markerFor(RUN_ID)).toBe(`<!-- agent:run=${RUN_ID} -->`)
    expect(extractRunId(markerFor(RUN_ID))).toBe(RUN_ID)
  })

  it('finds a marker embedded in a larger comment', () => {
    expect(extractRunId(`plan posted\n\n<!-- agent:run=${RUN_ID} -->\n`)).toBe(RUN_ID)
  })

  it('returns null when there is no marker', () => {
    expect(extractRunId('just a comment')).toBeNull()
  })

  it('returns null for a malformed marker', () => {
    expect(extractRunId('<!-- agent:run=not-a-run-id -->')).toBeNull()
  })

  it('picks the newest marker across comments', () => {
    expect(
      latestRunMarker([
        { body: markerFor(RUN_ID), created_at: '2026-10-11T09:00:00Z' },
        { body: markerFor(OTHER_RUN_ID), created_at: '2026-10-11T10:00:00Z' },
      ]),
    ).toEqual({ runId: OTHER_RUN_ID, createdAt: '2026-10-11T10:00:00Z' })
  })

  it('returns null when no comment carries a marker', () => {
    expect(latestRunMarker([{ body: 'hi', created_at: '2026-10-11T09:00:00Z' }])).toBeNull()
  })
})
