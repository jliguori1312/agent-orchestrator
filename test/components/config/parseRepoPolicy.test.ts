// Text-level tests for parseRepoPolicy: YAML string → validated policy. The
// caller (C2 later, fixtures here) hands over the raw text from the target
// repo; both YAML errors and schema violations surface as ConfigError.
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../../../src/components/config/configError.js'
import { parseRepoPolicy } from '../../../src/components/config/parseRepoPolicy.js'
import { validRepoPolicy } from './fixtures.js'

describe('parseRepoPolicy', () => {
  // Calls `run`, expecting it to throw ConfigError, and hands the caught error
  // back for message/issue assertions.
  function captureConfigError(run: () => void): ConfigError {
    try {
      run()
    } catch (thrown) {
      if (thrown instanceof ConfigError) return thrown
    }

    expect.fail('expected the call to throw ConfigError')
  }
  // The reference example from docs/config-reference.md, comment included.
  const referenceYaml = `tiers:
  eligible: [0, 1, 2, 3]   # tiers the agent may attempt
diff_budget:
  max_lines: 300
  max_files: 10
protected_paths: scripts/agent/protected-paths.txt
plan_gate: true             # G1 always-on for eligible tiers`

  it('parses the reference example into a valid policy', () => {
    expect(parseRepoPolicy(referenceYaml)).toEqual({ ...validRepoPolicy, plan_gate: true })
  })

  it('parses a policy without an explicit plan_gate, defaulting it to true', () => {
    const noGate = referenceYaml.replace(/plan_gate: .*\n?/, '')

    expect(parseRepoPolicy(noGate)).toEqual({ ...validRepoPolicy, plan_gate: true })
  })

  it('throws ConfigError on invalid YAML syntax', () => {
    expect(() => parseRepoPolicy('tiers:\n\teligible: [0]')).toThrow(ConfigError)
  })

  it('throws ConfigError on an empty document — required fields are missing', () => {
    expect(() => parseRepoPolicy('')).toThrow(ConfigError)
  })

  it('throws ConfigError naming the property on a schema violation', () => {
    // Valid YAML but an invalid policy: empty protected_paths and a zero max_lines.
    const brokenYaml = "tiers:\n  eligible: [1]\ndiff_budget:\n  max_lines: 0\n  max_files: 10\nprotected_paths: ''"

    expect(() => parseRepoPolicy(brokenYaml)).toThrow(ConfigError)
    const configError = captureConfigError(() => parseRepoPolicy(brokenYaml))
    expect(configError.issues.map((issue) => issue.path)).toContain('protected_paths')
  })
})
