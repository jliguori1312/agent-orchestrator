// Pure path derivation for the tick entrypoint. Keeping these boundary-free
// means the tick's directory layout is pinned by tests without touching the
// filesystem, and the three places the layout matters (journal shards, session
// transcripts, the read-only repo checkout) are named once instead of being
// re-derived at every call site.
import { join } from 'node:path'
import type { HostConfig } from '../config/hostConfigSchema.js'

// The S3/plan-gate policy file every target repo carries (framework §6).
export const POLICY_FILE_PATH = '.github/agent.yml'

// ADR-0005 §2: journal shards derive from workspace.root — no separate config
// key. The journal itself creates this directory on first write.
export function journalDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, 'journal')
}

// One directory per run groups both session transcripts (SEC7) under the run
// id, so a run's audit artifacts sit together.
export function sessionDirectory(workspaceRoot: string, runId: string): string {
  return join(workspaceRoot, 'sessions', runId)
}

// The read-only base clone the triage/plan sessions inspect: target repos are
// cloned under workspace.root (build plan §3). C4 owns the writable worktree
// lifecycle in M2; M1 only reads this checkout.
export function repoCheckoutDirectory(config: HostConfig): string {
  return join(config.workspace.root, repoName(config.target.repo))
}

// "owner/name" → "name". The host-config schema already guarantees exactly one
// slash pair, so the tail is always the repository name.
export function repoName(repo: string): string {
  const [, name = repo] = repo.split('/')
  return name
}
