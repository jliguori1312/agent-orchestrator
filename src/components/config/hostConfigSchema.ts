// Schema for the host config (orchestrator.jsonc — gitignored, hand-edited).
// Every object is strict so a typo'd key is refused and named instead of
// silently doing nothing, and nothing is defaulted or transformed so the
// parsed output is exactly what the operator wrote.
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import {
  appIdentifier,
  nonBlankString,
  positiveInteger,
  strictObjectNamingTypos,
} from './schemaPrimitives.js'

export const hostConfigSchema = strictObjectNamingTypos({
  target: strictObjectNamingTypos({
    // Exactly one "owner/name" slash pair — not a URL, not a bare repo name.
    repo: z.string().regex(/^[^\s/]+\/[^\s/]+$/, { error: 'must be "owner/name"' }),
    base: nonBlankString,
  }),
  github_app: strictObjectNamingTypos({
    app_id: appIdentifier,
    installation_id: appIdentifier,
  }),
  workspace: strictObjectNamingTypos({
    root: z.string().refine((value) => isAbsolute(value), { error: 'must be an absolute path' }),
  }),
  model: strictObjectNamingTypos({
    provider: nonBlankString,
    implement: nonBlankString,
    // D5 (implement vs review model) stays open until M3; an absent review
    // model means review falls back to `implement`.
    review: nonBlankString.optional(),
  }),
  verify: strictObjectNamingTypos({
    command: nonBlankString,
  }),
  guardrails: strictObjectNamingTypos({
    protected_paths: nonBlankString,
    diff_budget_lines: positiveInteger,
    diff_budget_files: positiveInteger,
  }),
  // There is no notification channel by design — `needs-human` rides the
  // GitHub App's @mentions (ADR-0003) — so a non-empty notify section is a
  // misunderstanding, not a setting.
  notify: strictObjectNamingTypos({}).optional(),
})

export type HostConfig = z.infer<typeof hostConfigSchema>
