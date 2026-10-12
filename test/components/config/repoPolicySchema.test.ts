// Schema-level tests for the per-target-repo policy (.github/agent.yml). This
// file governs what the agent is allowed to attempt in that repo, so unknown
// keys and out-of-range tiers must be refused, not ignored.
import { describe, expect, it } from 'vitest'
import { repoPolicySchema } from '../../../src/components/config/repoPolicySchema.js'
import { issuePaths, validRepoPolicy, withProperty, withoutProperty } from './fixtures.js'

describe('repoPolicySchema', () => {
  it('accepts the valid fixture unchanged', () => {
    const result = repoPolicySchema.safeParse(validRepoPolicy)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(validRepoPolicy)
  })

  it('defaults plan_gate to true when omitted — always-on for eligible tiers (D3)', () => {
    const result = repoPolicySchema.safeParse(validRepoPolicy)

    if (result.success) expect(result.data.plan_gate).toBe(true)
  })

  it('accepts review_model when present and leaves it undefined when absent', () => {
    const withoutReview = repoPolicySchema.safeParse(validRepoPolicy)
    expect(withoutReview.success).toBe(true)
    if (withoutReview.success) expect(withoutReview.data.review_model).toBeUndefined()

    const withReview = withProperty(validRepoPolicy, 'review_model', 'a-different-model')
    const parsedReview = repoPolicySchema.safeParse(withReview)
    expect(parsedReview.success).toBe(true)
    if (parsedReview.success) expect(parsedReview.data.review_model).toBe('a-different-model')

    const blankReview = withProperty(validRepoPolicy, 'review_model', '')
    expect(repoPolicySchema.safeParse(blankReview).success).toBe(false)
  })

  it('accepts an explicit plan_gate false', () => {
    const gateOff = withProperty(validRepoPolicy, 'plan_gate', false)
    const result = repoPolicySchema.safeParse(gateOff)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.plan_gate).toBe(false)
  })

  it('rejects a missing or empty tier list', () => {
    for (const broken of [
      withoutProperty(validRepoPolicy, 'tiers.eligible'),
      withoutProperty(validRepoPolicy, 'tiers'),
      withProperty(validRepoPolicy, 'tiers.eligible', []),
    ]) {
      const result = repoPolicySchema.safeParse(broken)

      expect(result.success).toBe(false)
      if (!result.success) {
        const reported = issuePaths(result.error)
        expect(
          reported.some((path) => path === 'tiers.eligible' || path.startsWith('tiers')),
          `reported: ${reported.join(', ')}`,
        ).toBe(true)
      }
    }
  })

  it('rejects tiers outside 0–9 and non-integer tiers', () => {
    for (const badTier of [10, -1, 3.5]) {
      const broken = withProperty(validRepoPolicy, 'tiers.eligible', [badTier])
      const result = repoPolicySchema.safeParse(broken)

      expect(result.success, `tier ${String(badTier)}`).toBe(false)
      if (!result.success) {
        expect(issuePaths(result.error)).toContain('tiers.eligible.0')
      }
    }
  })

  it('rejects missing or non-positive diff budgets', () => {
    for (const budgetPath of ['diff_budget.max_lines', 'diff_budget.max_files']) {
      const missing = withoutProperty(validRepoPolicy, budgetPath)
      const result = repoPolicySchema.safeParse(missing)

      expect(result.success, `${budgetPath} missing`).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain(budgetPath)

      for (const badBudget of [0, -300]) {
        const broken = withProperty(validRepoPolicy, budgetPath, badBudget)
        expect(repoPolicySchema.safeParse(broken).success, `${budgetPath} = ${badBudget}`).toBe(
          false,
        )
      }
    }
  })

  it('rejects a missing or non-positive protected-paths value', () => {
    const missing = withoutProperty(validRepoPolicy, 'protected_paths')
    expect(repoPolicySchema.safeParse(missing).success).toBe(false)

    const blank = withProperty(validRepoPolicy, 'protected_paths', '')
    const result = repoPolicySchema.safeParse(blank)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('protected_paths')
  })

  it('refuses plan_gate that is not a boolean', () => {
    const broken = withProperty(validRepoPolicy, 'plan_gate', 'yes')

    expect(repoPolicySchema.safeParse(broken).success).toBe(false)
  })

  it('refuses unknown top-level keys, including per-repo label overrides (labels stay in code, plan §6)', () => {
    const broken = withProperty(validRepoPolicy, 'labels', { blocked: 'agent-blocked' })
    const result = repoPolicySchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('labels')

    const typo = withProperty(validRepoPolicy, 'diff_budges', { max_lines: 1, max_files: 1 })
    const result2 = repoPolicySchema.safeParse(typo)
    expect(result2.success).toBe(false)
    if (!result2.success) expect(issuePaths(result2.error)).toContain('diff_budges')
  })
})
