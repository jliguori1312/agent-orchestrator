// Schema for the per-target-repo policy (.github/agent.yml). This file
// governs what the agent may attempt in that repo, so out-of-range tiers and
// unknown keys are refused, never ignored. Labels deliberately have no place
// here — the label state machine lives in code (plan §6).
import { z } from 'zod'
import {
  nonBlankString,
  positiveInteger,
  strictObjectNamingTypos,
} from '../../shared/schemaPrimitives.js'

export const repoPolicySchema = strictObjectNamingTypos({
  tiers: strictObjectNamingTypos({
    // The framework defines exactly tiers 0–9 (§2); the agent may never be
    // offered anything outside that range even if a policy asks for it.
    eligible: z.array(z.number().int().min(0).max(9)).min(1),
  }),
  diff_budget: strictObjectNamingTypos({
    max_lines: positiveInteger,
    max_files: positiveInteger,
  }),
  protected_paths: nonBlankString,
  // D3: the plan gate is always-on for eligible tiers; a repo may turn it
  // off explicitly, but omitting it means on. The default materializes in
  // the parsed policy so consumers never re-derive it.
  plan_gate: z.boolean().default(true),
  review_model: nonBlankString.optional(),
})

export type RepoPolicy = z.infer<typeof repoPolicySchema>
