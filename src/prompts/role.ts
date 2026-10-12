// The shared role shape (C6). A role bundles the three things a Pi session
// needs to behave correctly: its name, the system prompt that replaces Pi's
// default, and the S4 per-stage tool allowlist. Tool lists live here — not in
// the driver — so the stage-to-tools mapping has exactly one definition and
// the driver only ever joins what a role already declares.
export type RoleName = 'triage' | 'plan' | 'implement' | 'review'

export interface Role {
  readonly name: RoleName
  readonly systemPrompt: string
  readonly tools: readonly string[]
}

// S4 per-stage allowlist. Triage, plan, and review are read-only; implement is
// the only stage that may write, and it is scoped to exactly the write tools
// S4 names (edit, write, bash) plus the read tools it needs to inspect the tree.
export const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls'] as const
export const IMPLEMENT_TOOLS = [
  'read',
  'grep',
  'find',
  'ls',
  'edit',
  'write',
  'bash',
] as const
