// Field constraints and strictness helpers shared by every config/policy/
// journal schema in the orchestrator. Schemas must refuse the same failure
// shapes (blank strings, bad budgets, unknown keys), so each rule lives here
// exactly once instead of drifting between components.
import { z } from 'zod'

// Hand-edited values must carry real content; a blank string is always a
// template-placeholder mistake, never a valid choice.
export const nonBlankString = z.string().refine((value) => value.trim() !== '', {
  error: 'must not be blank',
})

// GitHub App identifiers arrive from the GitHub UI as digit-only strings;
// accepting numbers would let JSONC/YAML shorthand (`app_id: 123456`) pass
// validation and then disagree with the token-mint API's string form.
export const appIdentifier = z.string().regex(/^\d+$/, { error: 'must be a string of digits' })

// Diff budgets are line/file counts; zero or fractional values are config
// mistakes, not tight-but-valid limits.
export const positiveInteger = z.number().int().positive()

// A provider id names the model provider (pi's provider id, e.g. "openrouter"
// or "anthropic") and is turned into the systemd credential name "<id>-key",
// so it must already satisfy readCredential's filename pattern (lowercase, no
// slashes, dots, or whitespace).
export const providerId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
  error: 'must be a lowercase id of letters, digits, and hyphens (becomes "<id>-key")',
})

// zod 4's built-in strictness reports an unknown key at the *parent's* path
// ("Unrecognized key: 'deployment'" at path ['target']), with the typo itself
// only in the message. Our contract — and human readability — requires the
// path to name the typo ('target.deployment'), so unknown keys are detected
// and reported manually. A passthrough value can never reach a successful
// output (every unknown key adds an issue), so this behaves exactly like
// z.strictObject apart from the better issue paths.
type StrictObject<Shape extends z.ZodRawShape> = z.ZodObject<Shape, z.core.$strict>

export function strictObjectNamingTypos<Shape extends z.ZodRawShape>(
  shape: Shape,
): StrictObject<Shape> {
  const strictSchema = z.looseObject(shape).superRefine((value, ctx) => {
    for (const objectKey of Object.keys(value)) {
      if (!(objectKey in shape)) {
        ctx.addIssue({
          code: 'custom',
          path: [objectKey],
          message: `unrecognized key "${objectKey}"`,
        })
      }
    }
  })

  // The declared strict-object return type is what callers infer from, so
  // HostConfig/RepoPolicy never see looseObject's index signature — the
  // pipeline's own type only exists inside this function.
  return strictSchema
}
