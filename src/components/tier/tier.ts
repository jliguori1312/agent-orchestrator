// Autonomy tiers (framework §2). The triage session states the tier in prose
// for a human and in an HTML comment marker for the machine — the same
// convention as the run marker (registry/runMarker.ts): invisible in rendered
// Markdown, findable in the raw body. The marker is the machine source of
// truth; the prose is for the human reading the comment.
export const TIER_MIN = 0
export const TIER_MAX = 9

export type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

// A single digit, anchored by the HTML comment delimiters so prose that merely
// mentions "tier 3" cannot be mistaken for the machine marker.
export const TIER_MARKER_PATTERN = /<!-- agent:tier=([0-9]) -->/

export function isTier(value: number): value is Tier {
  return Number.isInteger(value) && value >= TIER_MIN && value <= TIER_MAX
}

// The framework's tier classes (§2) as the single in-code mapping from tier
// number to name. The triage prompt restates these for the model; this table
// is what the notifier names in a human-facing message, and the tier-mapping
// test keeps it complete over 0–9.
export const TIER_NAMES: Record<Tier, string> = {
  0: 'mechanical',
  1: 'tests',
  2: 'small UI or content',
  3: 'localized bugfix',
  4: 'refactor',
  5: 'cross-cutting',
  6: 'schema or migration',
  7: 'security or sensitive',
  8: 'hardware or infra',
  9: 'generated files',
}

export function tierMarkerFor(tier: Tier): string {
  return `<!-- agent:tier=${tier} -->`
}

// A missing or malformed marker is null, never a guess: triage output is
// untrusted input (SEC6), so a session that cannot classify is escalated
// rather than trusted to proceed.
export function extractTier(text: string): Tier | null {
  const digit = TIER_MARKER_PATTERN.exec(text)?.[1]
  if (digit === undefined) return null

  const tier = Number(digit)
  return isTier(tier) ? tier : null
}
