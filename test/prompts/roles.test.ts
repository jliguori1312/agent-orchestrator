// Tests for the four role definitions (C6). The invariants under test are the
// ones the pipeline gates depend on: each stage's tool allowlist matches S4
// (only implement may write), and each prompt carries the anchors its gate
// requires (G1 acceptance criteria + risk, S3 protected paths + G2 verify,
// G4 questions-not-verdicts).
import { describe, expect, it } from 'vitest'
import { implementRole } from '../../src/prompts/implement.js'
import { planRole } from '../../src/prompts/plan.js'
import { reviewRole } from '../../src/prompts/review.js'
import { IMPLEMENT_TOOLS, READ_ONLY_TOOLS } from '../../src/prompts/role.js'
import { ROLES } from '../../src/prompts/roles.js'
import { triageRole } from '../../src/prompts/triage.js'

const ALL_ROLES = [triageRole, planRole, implementRole, reviewRole]

describe('role prompts', () => {
  it('gives every role a non-blank name and system prompt', () => {
    for (const role of ALL_ROLES) {
      expect(role.name.trim(), role.name).not.toBe('')
      expect(role.systemPrompt.trim(), role.name).not.toBe('')
    }
  })

  it('registers exactly the four distinct role names', () => {
    expect(new Set(ALL_ROLES.map((role) => role.name)).size).toBe(4)
    expect(Object.keys(ROLES).sort()).toEqual(['implement', 'plan', 'review', 'triage'])
  })

  it('keeps triage, plan, and review read-only (S4)', () => {
    expect(triageRole.tools).toEqual([...READ_ONLY_TOOLS])
    expect(planRole.tools).toEqual([...READ_ONLY_TOOLS])
    expect(reviewRole.tools).toEqual([...READ_ONLY_TOOLS])
  })

  it('gives implement exactly the S4 write allowlist', () => {
    expect(implementRole.tools).toEqual([...IMPLEMENT_TOOLS])
    // The write allowlist is the read allowlist plus the three write tools S4
    // names — no more, no less.
    expect(IMPLEMENT_TOOLS).toEqual([...READ_ONLY_TOOLS, 'edit', 'write', 'bash'])
  })

  it('anchors the plan-gate requirements (G1)', () => {
    for (const role of [triageRole, planRole]) {
      expect(role.systemPrompt, role.name).toMatch(/acceptance criteria/i)
      expect(role.systemPrompt, role.name).toMatch(/risk/i)
    }
  })

  it('anchors the implement guardrails (S3, G2)', () => {
    expect(implementRole.systemPrompt).toMatch(/protected/i)
    expect(implementRole.systemPrompt).toMatch(/verify/i)
  })

  it('anchors the adversarial-review rule (G4)', () => {
    // The phrase may wrap across a line in the prompt, so match on whitespace.
    expect(reviewRole.systemPrompt).toMatch(/questions,\s+not\s+verdicts/i)
  })

  it('anchors the tier marker C7 extracts', () => {
    // Triage is the only role that classifies; the marker literal must appear
    // or the machine has no tier to gate on.
    expect(triageRole.systemPrompt).toMatch(/agent:tier=/)
    expect(planRole.systemPrompt).not.toMatch(/agent:tier=/)
  })
})
