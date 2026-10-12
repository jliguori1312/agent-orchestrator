// Shared fixtures and helpers for the config tests. Every test builds on the
// same minimal valid fixture and mutates exactly one property, so each test
// states only the thing it cares about.

// The smallest valid host config — structurally identical to
// orchestrator.example.jsonc. One key-based provider, with an explicit model
// for each role; review is a different model on the same provider (D5 amended
// by the single-provider simplification).
export const validHostConfig = {
  target: { repo: 'owner/repo', base: 'main' },
  github_app: { app_id: '123456', installation_id: '789012' },
  workspace: { root: '/var/lib/agent-orchestrator' },
  model: {
    provider: 'anthropic',
    triage: 'claude-sonnet-4-5',
    plan: 'claude-sonnet-4-5',
    implement: 'claude-sonnet-4-5',
    review: 'claude-opus-4-6',
  },
  verify: { command: './scripts/agent/verify.sh' },
  guardrails: {
    protected_paths: 'scripts/agent/protected-paths.txt',
    diff_budget_lines: 300,
    diff_budget_files: 10,
  },
}

// The .github/agent.yml policy example from docs/config-reference.md, minus
// plan_gate (schema defaults it to true) and review_model (optional).
export const validRepoPolicy = {
  tiers: { eligible: [0, 1, 2, 3] },
  diff_budget: { max_lines: 300, max_files: 10 },
  protected_paths: 'scripts/agent/protected-paths.txt',
}

// Every required property of the host config, dot-addressed — the missing-field
// test walks this list so that adding a required field without updating the
// test is caught at the fixture definition.
export const requiredHostConfigPaths = [
  'target.repo',
  'target.base',
  'github_app.app_id',
  'github_app.installation_id',
  'workspace.root',
  'model.provider',
  'model.triage',
  'model.plan',
  'model.implement',
  'model.review',
  'verify.command',
  'guardrails.protected_paths',
  'guardrails.diff_budget_lines',
  'guardrails.diff_budget_files',
]

// Clone `object`, then set or delete the property addressed by `path` in dot
// notation ('target.repo'), creating intermediate objects when setting.
export function withProperty(object: object, path: string, value: unknown): object {
  return applyAt(structuredClone(object), path.split('.'), (child, key) => {
    child[key] = value
    return child
  })
}

export function withoutProperty(object: object, path: string): object {
  return applyAt(structuredClone(object), path.split('.'), (child, key) => {
    delete child[key]
    return child
  })
}

// Walks the segments of a structured clone, applying `mutate` at the final
// parent so both set and delete can share the traversal without callers
// duplicating the path arithmetic.
type ChildMutation = (child: Record<string, unknown>, lastKey: string) => Record<string, unknown>

function applyAt(node: object, segments: string[], mutate: ChildMutation): object {
  if (segments.length === 0) return node
  const parent = asPlainRecord(node)
  const [head, ...rest] = segments
  if (head === undefined || head === '') return node

  if (rest.length === 0) return mutate(parent, head)

  const child = parent[head]
  if (child === null || typeof child !== 'object') return node
  return { ...parent, [head]: applyAt(child, rest, mutate) }
}

function asPlainRecord(node: object): Record<string, unknown> {
  return node as Record<string, unknown>
}

// Zod issue paths are PropertyKey[]; flatten to dot notation so tests can
// assert a specific field was named by the failure without depending on zod's
// internal issue-message wording.
export function issuePaths(zodError: { issues: readonly { path: PropertyKey[] }[] }): string[] {
  return zodError.issues.map((issue) => issue.path.map(String).join('.'))
}
