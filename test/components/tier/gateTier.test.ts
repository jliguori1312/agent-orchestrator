// Tests for C7's gate: the extracted tier against a repo's eligible set. The
// three outcomes are deliberately distinct — `unclassified` is not the same
// refusal as `ineligible`, and the notifier names which one happened.
import { describe, expect, it } from 'vitest'
import { gateTier } from '../../../src/components/tier/gateTier.js'

const ELIGIBLE = [0, 1, 2, 3]

describe('gateTier', () => {
  it('passes a tier the repo declares eligible', () => {
    expect(gateTier(3, ELIGIBLE)).toEqual({ kind: 'eligible', tier: 3 })
  })

  it('refuses a tier the repo does not declare eligible', () => {
    expect(gateTier(7, ELIGIBLE)).toEqual({ kind: 'ineligible', tier: 7 })
  })

  it('refuses a tier 0–9 that is simply not in the list', () => {
    // Tier 4 is a valid tier but this repo only opted into 0–3.
    expect(gateTier(4, ELIGIBLE)).toEqual({ kind: 'ineligible', tier: 4 })
  })

  it('reports an unclassified triage separately from an ineligible tier', () => {
    expect(gateTier(null, ELIGIBLE)).toEqual({ kind: 'unclassified' })
  })
})
