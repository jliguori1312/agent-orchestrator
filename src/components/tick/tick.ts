// The tick entrypoint (PR 7/M1): one systemd-timer invocation claims a single
// `agent-ready` issue and drives the read-only triage → plan gate. This is the
// only place the C1–C7/C14/C15 components are composed, so it is written as a
// dependency-injected function rather than a script: every boundary (`gh`,
// `pi`, the journal, time, run-id) is injected and the whole flow is
// unit-testable with fakes. The real wiring lives in src/main.ts.
import type { AgentSessionResult, AgentSessionSpec } from '../agent/agentDriver.js'
import type { HostConfig } from '../config/hostConfigSchema.js'
import { modelForRole } from '../config/modelSelection.js'
import { parseRepoPolicy } from '../config/parseRepoPolicy.js'
import type { RepoPolicy } from '../config/repoPolicySchema.js'
import { GitHubError } from '../github/githubError.js'
import type { GithubComment, GithubIssue } from '../github/githubSchemas.js'
import type { JournalEventInput } from '../journal/journal.js'
import { notifyNeedsHuman, type NeedsHumanNotice } from '../notifier/notifier.js'
import { LABELS } from '../registry/labels.js'
import { claimNextRun, reclaimStaleRun, transition } from '../registry/runRegistry.js'
import { ROLES } from '../../prompts/roles.js'
import { gateTier } from '../tier/gateTier.js'
import { extractTier, type Tier } from '../tier/tier.js'
import { composeIssuePrompt } from './issuePrompt.js'
import { POLICY_FILE_PATH, repoCheckoutDirectory, sessionDirectory } from './tickPaths.js'

// The slice of C2 the tick needs: the union of what the registry (claim /
// reclaim / label), the notifier (comment), and the policy fetch require.
// Declared structurally so one small fake serves the whole tick test.
export interface TickGitHub {
  listIssuesByLabel(label: string): Promise<GithubIssue[]>
  listComments(issueNumber: number): Promise<GithubComment[]>
  postComment(issueNumber: number, body: string): Promise<void>
  setLabels(
    issueNumber: number,
    change: { readonly add: readonly string[]; readonly remove: readonly string[] },
  ): Promise<void>
  lastLabelActor(issueNumber: number, labelName: string): Promise<string | null>
  isCollaborator(login: string): Promise<boolean>
  getRepoFile(path: string): Promise<string>
}

export interface TickJournal {
  append(input: JournalEventInput): void
}

export type RunSession = (spec: AgentSessionSpec) => Promise<AgentSessionResult>

export interface TickDeps {
  readonly github: TickGitHub
  readonly journal: TickJournal
  readonly config: HostConfig
  // The pi boundary (C5). Injected so tests script session output; the real
  // value is runAgentSession (bound in main.ts).
  readonly runSession: RunSession
  // The "<provider>-key" systemd credential (ADR-0004). Read once per tick,
  // passed to every session as --api-key, never an ambient env var.
  readonly readProviderKey: () => string
  readonly now?: () => Date
  readonly generateRunId?: () => string
}

export type EscalationReason = 'unclassified-tier' | 'ineligible-tier' | 'policy-unavailable'

export type TickOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'triaged'; readonly runId: string; readonly issueNumber: number }
  | {
      readonly kind: 'escalated'
      readonly runId: string
      readonly issueNumber: number
      readonly reason: EscalationReason
    }

interface RunContext {
  readonly issue: GithubIssue
  readonly actor: string
  readonly runId: string
}

type Escalation =
  | { readonly reason: 'unclassified-tier' }
  | { readonly reason: 'ineligible-tier'; readonly tier: Tier }
  | { readonly reason: 'policy-unavailable' }

// One tick: reclaim anything stalled, then claim and process at most one issue
// (single slot, ADR-0002 D2). The claim is SEC2-guarded inside claimNextRun.
export async function runTick(deps: TickDeps): Promise<TickOutcome> {
  await reclaimStaleRuns(deps)

  const claimed = await claimNextRun({
    github: deps.github,
    journal: deps.journal,
    now: deps.now,
    generateRunId: deps.generateRunId,
  })
  if (claimed === null) return { kind: 'idle' }

  const context: RunContext = {
    issue: claimed.issue,
    actor: claimed.actor,
    runId: claimed.outcome.runId,
  }

  try {
    return await triageAndPlan(deps, context)
  } catch (failure) {
    // SEC7: the JSONL journal — not only the systemd log — records the failure.
    // The run stays `agent-in-progress`; a later tick's reclaim escalates it.
    deps.journal.append({
      run_id: context.runId,
      event: 'run.failed',
      issue: context.issue.number,
      data: { error: describeFailure(failure) },
    })
    throw failure
  }
}

async function reclaimStaleRuns(deps: TickDeps): Promise<void> {
  const inFlight = await deps.github.listIssuesByLabel(LABELS.inProgress)

  for (const issue of inFlight) {
    await reclaimStaleRun({
      github: deps.github,
      journal: deps.journal,
      issue,
      now: deps.now,
    })
  }
}

async function triageAndPlan(deps: TickDeps, context: RunContext): Promise<TickOutcome> {
  const { issue, actor, runId } = context
  const prompt = composeIssuePrompt(issue)
  const sessionDir = sessionDirectory(deps.config.workspace.root, runId)
  const cwd = repoCheckoutDirectory(deps.config)
  const apiKey = deps.readProviderKey()

  // 1. Triage (Phase 1): classify the tier. The output also carries the human
  //    risk assessment; the transcript is retained (SEC7).
  const triage = await deps.runSession(
    sessionSpec(context, { sessionDir, cwd, apiKey, prompt, role: 'triage', config: deps.config }),
  )
  const tier = extractTier(triage.output)
  deps.journal.append({
    run_id: runId,
    event: 'triage.completed',
    issue: issue.number,
    data: { tier, sessionFile: triage.sessionFile },
  })

  if (tier === null) return escalate(deps, context, { reason: 'unclassified-tier' })

  // 2. Gate the tier against the target repo's policy. A missing or malformed
  //    policy means eligibility cannot be decided — escalate, never proceed.
  const policy = await loadRepoPolicy(deps, context)
  if (policy === null) return escalate(deps, context, { reason: 'policy-unavailable' })

  const decision = gateTier(tier, policy.tiers.eligible)
  if (decision.kind === 'ineligible') {
    return escalate(deps, context, { reason: 'ineligible-tier', tier: decision.tier })
  }
  // `tier` was non-null above, so gateTier cannot report `unclassified` here;
  // the branch is kept so the gate's decision type stays exhaustively handled.
  if (decision.kind === 'unclassified') {
    return escalate(deps, context, { reason: 'unclassified-tier' })
  }

  // 3. Plan (G1): the artifact the human approves with /approve-plan.
  const plan = await deps.runSession(
    sessionSpec(context, { sessionDir, cwd, apiKey, prompt, role: 'plan', config: deps.config }),
  )
  deps.journal.append({
    run_id: runId,
    event: 'plan.completed',
    issue: issue.number,
    data: { sessionFile: plan.sessionFile },
  })

  // 4. Post the plan — the @mention notification IS the plan comment — then
  //    move to needs-human-plan-approval and stop. No branch, no PR (M1).
  await notifyNeedsHuman({
    github: deps.github,
    journal: deps.journal,
    notice: { reason: 'plan-ready', plan: plan.output, runId, issueNumber: issue.number, actor },
  })
  await transition({
    github: deps.github,
    journal: deps.journal,
    issueNumber: issue.number,
    from: LABELS.inProgress,
    to: LABELS.planApproval,
    runId,
  })

  return { kind: 'triaged', runId, issueNumber: issue.number }
}

// Every stop-for-a-human path posts one @mention notice and moves the label to
// `needs-human` (a legal move from `agent-in-progress`). Kept in one place so
// an ineligible tier, an unclassifiable one, and an unusable policy all leave
// the same audit shape.
async function escalate(
  deps: TickDeps,
  context: RunContext,
  escalation: Escalation,
): Promise<TickOutcome> {
  const { runId, issue, actor } = context
  const base = { runId, issueNumber: issue.number, actor }
  const notice: NeedsHumanNotice =
    escalation.reason === 'ineligible-tier'
      ? { reason: 'ineligible-tier', tier: escalation.tier, ...base }
      : { reason: escalation.reason, ...base }

  await notifyNeedsHuman({ github: deps.github, journal: deps.journal, notice })
  await transition({
    github: deps.github,
    journal: deps.journal,
    issueNumber: issue.number,
    from: LABELS.inProgress,
    to: LABELS.needsHuman,
    runId,
  })

  return { kind: 'escalated', runId, issueNumber: issue.number, reason: escalation.reason }
}

// null means "no usable policy" (missing or malformed); both are escalated by
// the caller. A 404 is the expected "file absent" answer, so it is not an
// exception the tick should propagate; any other GitHub failure is real.
async function loadRepoPolicy(deps: TickDeps, context: RunContext): Promise<RepoPolicy | null> {
  let policyText: string
  try {
    policyText = await deps.github.getRepoFile(POLICY_FILE_PATH)
  } catch (failure) {
    if (failure instanceof GitHubError && failure.httpStatus === 404) {
      journalUnavailablePolicy(deps, context, 'not-found')
      return null
    }
    throw failure
  }

  try {
    return parseRepoPolicy(policyText)
  } catch (failure) {
    journalUnavailablePolicy(deps, context, 'invalid', describeFailure(failure))
    return null
  }
}

function journalUnavailablePolicy(
  deps: TickDeps,
  context: RunContext,
  cause: 'not-found' | 'invalid',
  error?: string,
): void {
  const data: Record<string, unknown> = { policy: POLICY_FILE_PATH, cause }
  if (error !== undefined) data.error = error

  deps.journal.append({
    run_id: context.runId,
    event: 'policy.unavailable',
    issue: context.issue.number,
    data,
  })
}

interface SessionInputs {
  readonly sessionDir: string
  readonly cwd: string
  readonly apiKey: string
  readonly prompt: string
  readonly role: 'triage' | 'plan'
  readonly config: HostConfig
}

// The two read-only sessions differ only by role, so the AgentSessionSpec is
// assembled once: the run id plus the role names the session (both transcripts
// live under the run's session dir), and the role's model comes from config.
function sessionSpec(context: RunContext, inputs: SessionInputs): AgentSessionSpec {
  return {
    sessionDir: inputs.sessionDir,
    sessionId: `${context.runId}-${inputs.role}`,
    role: ROLES[inputs.role],
    model: modelForRole(inputs.config, inputs.role),
    apiKey: inputs.apiKey,
    prompt: inputs.prompt,
    cwd: inputs.cwd,
  }
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)
}
