// C15 — the notifier. Per ADR-0003 there is no separate ntfy/email channel:
// `needs-human` delivery rides the GitHub App's @mention, which triggers
// GitHub's native mobile and email notifications. This component therefore
// composes the mention comment and posts it — nothing more.
import type { JournalEventInput } from '../journal/journal.js'
import { markerFor } from '../registry/runMarker.js'
import { TIER_NAMES, type Tier } from '../tier/tier.js'

// A discriminated union on `reason` so each notice carries only what its
// reason needs: the tier for an ineligible-tier notice, the plan body for a
// plan-ready one, and neither for an unclassified triage.
export type NeedsHumanNotice =
  | {
      readonly reason: 'ineligible-tier'
      readonly tier: Tier
      readonly runId: string
      readonly issueNumber: number
      readonly actor: string
    }
  | {
      readonly reason: 'unclassified-tier'
      readonly runId: string
      readonly issueNumber: number
      readonly actor: string
    }
  | {
      readonly reason: 'policy-unavailable'
      readonly runId: string
      readonly issueNumber: number
      readonly actor: string
    }
  | {
      readonly reason: 'plan-ready'
      readonly plan: string
      readonly runId: string
      readonly issueNumber: number
      readonly actor: string
    }

// The slice of C2 the notifier needs, declared structurally so tests supply a
// one-method fake — mirrors the registry's RegistryGitHub pattern.
export interface NotifierGitHub {
  postComment(issueNumber: number, body: string): Promise<void>
}

export interface NotifierJournal {
  append(input: JournalEventInput): void
}

// A switch on the discriminant so `notice.tier` is narrowed to the reason
// that carries it; adding a reason without a message becomes a type error
// because the end of the function turns reachable.
function describeNotice(notice: NeedsHumanNotice): string {
  switch (notice.reason) {
    case 'ineligible-tier':
      return `triage classified this issue as tier ${notice.tier} (${TIER_NAMES[notice.tier]}), which is not agent-eligible for this repository. No implementation will start — a human should decide how to proceed.`
    case 'unclassified-tier':
      return 'triage produced no machine-readable tier for this issue. Rather than guess, the run stops here for a human decision.'
    case 'policy-unavailable':
      return "this repository's `.github/agent.yml` policy could not be read or validated, so the issue's tier could not be checked against it. A human should fix the policy (or decide how to proceed) before an agent runs against this repository."
    case 'plan-ready':
      return `a plan is ready for review. Approve with \`/approve-plan\` or leave feedback.\n\n---\n\n${notice.plan}`
  }
}

// Every run-scoped comment carries the run id (plan §6); the @mention is what
// makes GitHub notify the human. The actor is the collaborator who applied
// `agent-ready` (SEC2-validated), so it is already a real login.
export function composeNeedsHumanComment(notice: NeedsHumanNotice): string {
  return `${markerFor(notice.runId)}\n\n@${notice.actor} — ${describeNotice(notice)}`
}

export async function notifyNeedsHuman(input: {
  readonly github: NotifierGitHub
  readonly journal: NotifierJournal
  readonly notice: NeedsHumanNotice
}): Promise<void> {
  await input.github.postComment(input.notice.issueNumber, composeNeedsHumanComment(input.notice))

  const data: Record<string, unknown> = { reason: input.notice.reason, actor: input.notice.actor }
  if (input.notice.reason === 'ineligible-tier') data.tier = input.notice.tier

  input.journal.append({
    run_id: input.notice.runId,
    event: 'notify.needs-human',
    issue: input.notice.issueNumber,
    data,
  })
}
