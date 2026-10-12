// Tests for the label state machine (plan §6). The map is the single source of
// truth, so these tests lock the legal moves and prove every label has a
// defined destination list (a new label without an entry fails here).
import { describe, expect, it } from 'vitest'
import {
  LABELS,
  NEXT_LABELS,
  canTransition,
  type Label,
} from '../../../src/components/registry/labels.js'

describe('canTransition', () => {
  it('allows the documented forward path', () => {
    expect(canTransition(LABELS.ready, LABELS.inProgress)).toBe(true)
    expect(canTransition(LABELS.inProgress, LABELS.planApproval)).toBe(true)
  })

  it('refuses skipping a step', () => {
    expect(canTransition(LABELS.ready, LABELS.planApproval)).toBe(false)
  })

  it('treats terminal labels as terminal', () => {
    for (const terminal of [LABELS.merged, LABELS.needsHuman, LABELS.blocked, LABELS.fixNeeded]) {
      expect(NEXT_LABELS[terminal]).toEqual([])
    }
  })

  it('defines a transition list for every label', () => {
    const labels: Label[] = Object.values(LABELS)
    for (const label of labels) {
      expect(NEXT_LABELS[label]).toBeDefined()
    }
  })
})
