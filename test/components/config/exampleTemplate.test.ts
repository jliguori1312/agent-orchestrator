// Drift guard: the committed orchestrator.example.jsonc template must always
// validate against the host-config schema. Its placeholders ("owner/your-repo",
// "123456") are chosen to pass on purpose, so the template can never silently
// rot away from what the orchestrator actually accepts.
import { describe, expect, it } from 'vitest'
import { loadHostConfig } from '../../../src/components/config/loadHostConfig.js'

describe('orchestrator.example.jsonc (template drift guard)', () => {
  // test/components/config/ → repo root is three levels up.
  const templatePath = new URL('../../../orchestrator.example.jsonc', import.meta.url).pathname

  it('validates against the host-config schema', () => {
    const config = loadHostConfig(templatePath)

    expect(config.target.repo).toBe('owner/your-repo')
    expect(config.target.base).toBe('main')
    expect(config.github_app.app_id).toBe('123456')
  })

  it('carries a provider and a model for every role', () => {
    const config = loadHostConfig(templatePath)

    for (const role of ['triage', 'plan', 'implement', 'review'] as const) {
      expect(config.model[role].trim(), role).not.toBe('')
    }
  })
})
