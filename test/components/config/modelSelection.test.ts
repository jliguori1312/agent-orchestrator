// Tests for the config → agent mapping (C1/C5 seam). The invariants: every role
// resolves to the single configured provider with that role's model, the
// credential name is derived from the provider (so a provider switch without a
// matching credential fails fast), and the role keys stay aligned with the
// prompt registry.
import { describe, expect, it } from 'vitest'
import { hostConfigSchema } from '../../../src/components/config/hostConfigSchema.js'
import { credentialNameForProvider, modelForRole } from '../../../src/components/config/modelSelection.js'
import { ROLES } from '../../../src/prompts/roles.js'
import { validHostConfig, withProperty } from './fixtures.js'

describe('modelForRole', () => {
  it('returns the single configured provider with the role-specific model', () => {
    for (const role of ['triage', 'plan', 'implement', 'review'] as const) {
      expect(modelForRole(validHostConfig, role)).toEqual({
        provider: 'anthropic',
        model: validHostConfig.model[role],
      })
    }
  })

  it('reflects a changed provider while keeping the role model', () => {
    const openrouter = hostConfigSchema.parse(
      withProperty(validHostConfig, 'model.provider', 'openrouter'),
    )
    const selected = modelForRole(openrouter, 'review')

    expect(selected.provider).toBe('openrouter')
    expect(selected.model).toBe(validHostConfig.model.review)
  })

  it('covers exactly the roles the prompt registry defines', () => {
    const resolvedRoles = (['triage', 'plan', 'implement', 'review'] as const).map(
      (role) => modelForRole(validHostConfig, role).provider,
    )

    expect(Object.keys(ROLES).sort()).toEqual(['implement', 'plan', 'review', 'triage'])
    expect(resolvedRoles).toHaveLength(4)
  })
})

describe('credentialNameForProvider', () => {
  it('derives the "<provider>-key" credential the host loads', () => {
    expect(credentialNameForProvider('anthropic')).toBe('anthropic-key')
    expect(credentialNameForProvider('openrouter')).toBe('openrouter-key')
    expect(credentialNameForProvider('opencode')).toBe('opencode-key')
  })
})
