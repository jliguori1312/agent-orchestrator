// Schema-level tests for the host config (orchestrator.jsonc). The happy path
// must pass untouched; every failure mode must be refused and must name the
// offending property path, so a misconfigured host fails fast with a message
// a human can act on.
import { describe, expect, it } from 'vitest'
import { hostConfigSchema } from '../../../src/components/config/hostConfigSchema.js'
import {
  issuePaths,
  requiredHostConfigPaths,
  validHostConfig,
  withProperty,
  withoutProperty,
} from './fixtures.js'

describe('hostConfigSchema', () => {
  it('accepts the valid fixture unchanged', () => {
    const result = hostConfigSchema.safeParse(validHostConfig)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toEqual(validHostConfig)
  })

  it('accepts an absent notify section (there is no channel by design)', () => {
    expect(validHostConfig).not.toHaveProperty('notify')
    expect(hostConfigSchema.safeParse(validHostConfig).success).toBe(true)
  })

  it('accepts an empty notify section', () => {
    const withNotify = withProperty(validHostConfig, 'notify', {})

    expect(hostConfigSchema.safeParse(withNotify).success).toBe(true)
  })

  it('returns the same values it accepted — no silent defaults on the host config', () => {
    const result = hostConfigSchema.safeParse(validHostConfig)

    if (result.success) {
      expect(result.data.target).toEqual(validHostConfig.target)
      expect(result.data.guardrails).toEqual(validHostConfig.guardrails)
    }
  })

  it('rejects every missing required field, naming its path', () => {
    for (const missingPath of requiredHostConfigPaths) {
      const broken = withoutProperty(validHostConfig, missingPath)
      const result = hostConfigSchema.safeParse(broken)

      expect(result.success, missingPath).toBe(false)
      if (!result.success) {
        expect(issuePaths(result.error), missingPath).toContain(missingPath)
      }
    }
  })

  it('rejects a repository name that is not owner/name', () => {
    for (const badRepo of ['no-slash', 'owner/repo/extra', '', 'owner/']) {
      const broken = withProperty(validHostConfig, 'target.repo', badRepo)
      const result = hostConfigSchema.safeParse(broken)

      expect(result.success, `repo "${badRepo}"`).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('target.repo')
    }
  })

  it('rejects a blank base branch', () => {
    const broken = withProperty(validHostConfig, 'target.base', '  ')

    expect(hostConfigSchema.safeParse(broken).success).toBe(false)
  })

  it('rejects GitHub App identifiers that are not digit-only strings', () => {
    for (const badId of ['abc', '123 456', '', 12.5, 123456]) {
      const broken = withProperty(validHostConfig, 'github_app.app_id', badId)
      const result = hostConfigSchema.safeParse(broken)

      expect(result.success, `app_id ${String(badId)}`).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('github_app.app_id')
    }
  })

  it('rejects a relative workspace root', () => {
    const broken = withProperty(validHostConfig, 'workspace.root', 'var/lib/agent-orchestrator')

    const result = hostConfigSchema.safeParse(broken)
    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('workspace.root')
  })

  it('rejects diff budgets that are not positive integers', () => {
    for (const badBudget of [0, -5, 12.5]) {
      for (const budgetPath of ['guardrails.diff_budget_lines', 'guardrails.diff_budget_files']) {
        const broken = withProperty(validHostConfig, budgetPath, badBudget)
        const result = hostConfigSchema.safeParse(broken)

        expect(result.success, `${budgetPath} = ${String(badBudget)}`).toBe(false)
        if (!result.success) expect(issuePaths(result.error)).toContain(budgetPath)
      }
    }
  })

  it('rejects a blank model or verify value', () => {
    for (const blankPath of [
      'model.provider',
      'model.triage',
      'model.plan',
      'model.implement',
      'model.review',
      'verify.command',
    ]) {
      const broken = withProperty(validHostConfig, blankPath, '')
      const result = hostConfigSchema.safeParse(broken)

      expect(result.success, blankPath).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain(blankPath)
    }
  })

  it('rejects a provider id that is not credential-name safe', () => {
    for (const badProvider of ['OpenRouter', 'open.router', 'open/router', ' openrouter', '']) {
      const broken = withProperty(validHostConfig, 'model.provider', badProvider)
      const result = hostConfigSchema.safeParse(broken)

      expect(result.success, `provider "${badProvider}"`).toBe(false)
      if (!result.success) expect(issuePaths(result.error)).toContain('model.provider')
    }
  })

  it('accepts a key-based provider other than anthropic', () => {
    for (const provider of ['openrouter', 'opencode', 'ollama', 'cloudflare-workers-ai']) {
      const broken = withProperty(validHostConfig, 'model.provider', provider)

      expect(hostConfigSchema.safeParse(broken).success, provider).toBe(true)
    }
  })

  it('accepts a model per role, and rejects a blank one for any role', () => {
    for (const rolePath of [
      'model.triage',
      'model.plan',
      'model.implement',
      'model.review',
    ]) {
      const withModel = withProperty(validHostConfig, rolePath, 'some-model')
      expect(hostConfigSchema.safeParse(withModel).success, rolePath).toBe(true)

      const blankModel = withProperty(validHostConfig, rolePath, '')
      expect(hostConfigSchema.safeParse(blankModel).success, `${rolePath} blank`).toBe(false)
    }
  })

  it('rejects a blank protected-paths value', () => {
    const blank = withProperty(validHostConfig, 'guardrails.protected_paths', '')
    expect(hostConfigSchema.safeParse(blank).success).toBe(false)
  })

  it('rejects an absent model.review only when present and blank — it is optional (D5 open)', () => {
    expect(hostConfigSchema.safeParse(validHostConfig).success).toBe(true)

    const withReview = withProperty(validHostConfig, 'model.review', 'claude-opus-4-6')
    expect(hostConfigSchema.safeParse(withReview).success).toBe(true)

    const blankReview = withProperty(validHostConfig, 'model.review', '')
    expect(hostConfigSchema.safeParse(blankReview).success).toBe(false)
  })

  it('rejects unknown top-level keys, naming the typo', () => {
    const typo = withProperty(validHostConfig, 'models', { provider: 'anthropic' })
    const result = hostConfigSchema.safeParse(typo)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('models')
  })

  it('rejects an unknown model role key, naming the typo', () => {
    const typo = withProperty(validHostConfig, 'model.implementer', 'some-model')
    const result = hostConfigSchema.safeParse(typo)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('model.implementer')
  })

  it('rejects unknown nested keys, naming the typo', () => {
    const typo = withProperty(validHostConfig, 'target.deployment', 'lxc')
    const result = hostConfigSchema.safeParse(typo)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('target.deployment')
  })

  it('rejects a non-empty notify section — channels ride the GitHub App, per ADR-0003', () => {
    const broken = withProperty(validHostConfig, 'notify', { channel: 'ntfy' })
    const result = hostConfigSchema.safeParse(broken)

    expect(result.success).toBe(false)
    if (!result.success) expect(issuePaths(result.error)).toContain('notify.channel')
  })
})
