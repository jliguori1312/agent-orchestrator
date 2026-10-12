// C7's gate: the tier a triage session extracted, checked against the target
// repo's agent-eligible set (.github/agent.yml tiers.eligible, already
// range-validated by C1). The decision is data, not an exception — an
// ineligible tier is a normal outcome (a human decides), not a bug.
import type { Tier } from './tier.js'

export type TierGateDecision =
  | { readonly kind: 'eligible'; readonly tier: Tier }
  | { readonly kind: 'ineligible'; readonly tier: Tier }
  | { readonly kind: 'unclassified' }

export function gateTier(tier: Tier | null, eligible: readonly number[]): TierGateDecision {
  if (tier === null) return { kind: 'unclassified' }

  return eligible.includes(tier) ? { kind: 'eligible', tier } : { kind: 'ineligible', tier }
}
