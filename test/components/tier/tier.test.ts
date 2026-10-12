// Tests for the tier marker protocol (C7). The contract under test is the
// extraction from triage prose: a well-formed marker yields its digit, and
// anything else — absent, malformed, or out of range — yields null rather than
// a guess (SEC6).
import { describe, expect, it } from 'vitest'
import {
  extractTier,
  isTier,
  TIER_MAX,
  TIER_MIN,
  TIER_NAMES,
  tierMarkerFor,
  type Tier,
} from '../../../src/components/tier/tier.js'

const ALL_TIERS: readonly Tier[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

describe('tierMarkerFor', () => {
  it('wraps a tier in the marker the extractor recognises', () => {
    expect(tierMarkerFor(3)).toBe('<!-- agent:tier=3 -->')
  })
})

describe('extractTier', () => {
  it('reads the tier from the marker inside a prose assessment', () => {
    const triageOutput = `This is a localized bugfix with a clear reproduction.

Risk: touches one module; blast radius is small.

<!-- agent:tier=3 -->`

    expect(extractTier(triageOutput)).toBe(3)
  })

  it('round-trips every tier', () => {
    for (const tier of ALL_TIERS) {
      expect(extractTier(tierMarkerFor(tier))).toBe(tier)
    }
  })

  it('returns null when no marker is present', () => {
    expect(extractTier('A plan with no machine-readable tier.')).toBeNull()
  })

  it('returns null for a malformed marker', () => {
    // Two digits, an empty digit, and the marker text without HTML delimiters
    // are all refusals — not a partial read of the first digit.
    expect(extractTier('<!-- agent:tier=10 -->')).toBeNull()
    expect(extractTier('<!-- agent:tier= -->')).toBeNull()
    expect(extractTier('agent:tier=3')).toBeNull()
    expect(extractTier('<!-- agent:tier=3-->')).toBeNull()
  })

  it('does not mistake prose that merely mentions a tier', () => {
    expect(extractTier('This looks like tier 3 work.')).toBeNull()
  })
})

describe('isTier', () => {
  it('accepts the inclusive 0–9 range', () => {
    expect(isTier(TIER_MIN)).toBe(true)
    expect(isTier(TIER_MAX)).toBe(true)
    expect(isTier(5)).toBe(true)
  })

  it('rejects out-of-range and non-integer values', () => {
    expect(isTier(-1)).toBe(false)
    expect(isTier(10)).toBe(false)
    expect(isTier(3.5)).toBe(false)
    expect(isTier(Number.NaN)).toBe(false)
  })
})

describe('TIER_NAMES', () => {
  it('maps every tier 0–9 to a non-blank class name', () => {
    expect(Object.keys(TIER_NAMES).sort()).toEqual(
      Array.from({ length: TIER_MAX - TIER_MIN + 1 }, (_, index) => String(TIER_MIN + index)),
    )
    for (const name of Object.values(TIER_NAMES)) {
      expect(name.trim()).not.toBe('')
    }
  })
})
