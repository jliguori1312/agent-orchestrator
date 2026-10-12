// C6 — the four roles assembled. ROLES is the lookup the tick uses, so a role
// name alone selects both the prompt and the S4 tool allowlist; the individual
// roles keep their own modules so their prompt text stays readable.
import type { Role, RoleName } from './role.js'
import { implementRole } from './implement.js'
import { planRole } from './plan.js'
import { reviewRole } from './review.js'
import { triageRole } from './triage.js'

export const ROLES: Record<RoleName, Role> = {
  triage: triageRole,
  plan: planRole,
  implement: implementRole,
  review: reviewRole,
}
