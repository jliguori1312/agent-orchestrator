// The run registry (C3): labels plus a run-marker comment are the only state
// store, so claiming is one label move and one comment, and a re-tick is made
// idempotent by the marker. The scheduler is single-slot (ADR-0002 D2), so
// there is never a concurrent claimer — the marker is a sufficient idempotency
// token and no lock or database is needed.
import type { GithubComment, GithubIssue } from '../github/githubSchemas.js'
import type { JournalEventInput } from '../journal/journal.js'
import { generateRunId } from '../journal/runId.js'
import { LABELS, canTransition, type Label } from './labels.js'
import { latestRunMarker, markerFor } from './runMarker.js'
import { RegistryError } from './registryError.js'

// The window after which an in-flight run is presumed stalled. Trips during
// read-only triage are fast, so a run still `agent-in-progress` this long later
// means the tick died (or Pi hung), not that it needs more time.
export const DEFAULT_RECLAIM_AFTER_MINUTES = 60

// The slice of C2 the registry needs, declared structurally rather than as the
// concrete GitHubClient so tests can supply a small fake.
export interface RegistryGitHub {
  listIssuesByLabel(label: string): Promise<GithubIssue[]>
  listComments(issueNumber: number): Promise<GithubComment[]>
  postComment(issueNumber: number, body: string): Promise<void>
  setLabels(
    issueNumber: number,
    change: { add: readonly string[]; remove: readonly string[] },
  ): Promise<void>
  lastLabelActor(issueNumber: number, labelName: string): Promise<string | null>
  isCollaborator(login: string): Promise<boolean>
}

export interface RegistryJournal {
  append(input: JournalEventInput): void
}

export interface RegistryDeps {
  readonly github: RegistryGitHub
  readonly journal: RegistryJournal
  readonly now?: () => Date
  readonly reclaimAfterMinutes?: number
  readonly generateRunId?: () => string
}

export type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly runId: string }
  | { readonly kind: 'resumed'; readonly runId: string }
  | { readonly kind: 'already-live'; readonly runId: string }

export type ReclaimOutcome =
  | { readonly kind: 'reclaimed'; readonly runId: string }
  | { readonly kind: 'live'; readonly runId: string }
  | { readonly kind: 'not-in-flight' }

export async function findAgentReadyIssues(github: RegistryGitHub): Promise<GithubIssue[]> {
  const issues = await github.listIssuesByLabel(LABELS.ready)
  // FIFO: oldest issue number first, so a burst of ready issues is worked in
  // the order it was opened rather than in whatever order the API returned.
  return [...issues].sort((left, right) => left.number - right.number)
}

// SEC2: `agent-ready` is only a trigger when a collaborator applied it. Returns
// the trusted actor, or throws so the caller can decide to skip the issue.
export async function assertTrustedActor(
  github: RegistryGitHub,
  issue: GithubIssue,
): Promise<string> {
  const actor = await github.lastLabelActor(issue.number, LABELS.ready)
  if (actor === null) {
    throw new RegistryError(
      `Issue #${issue.number} carries ${LABELS.ready} but the timeline records no labeller`,
    )
  }
  if (!(await github.isCollaborator(actor))) {
    throw new RegistryError(
      `Issue #${issue.number} was labelled ${LABELS.ready} by untrusted actor "${actor}" (SEC2)`,
    )
  }
  return actor
}

export async function postRunMarker(input: {
  readonly github: RegistryGitHub
  readonly journal: RegistryJournal
  readonly issueNumber: number
  readonly runId: string
}): Promise<void> {
  await input.github.postComment(input.issueNumber, markerFor(input.runId))
  input.journal.append({ run_id: input.runId, event: 'run.marker-posted', issue: input.issueNumber })
}

export async function transition(input: {
  readonly github: RegistryGitHub
  readonly journal: RegistryJournal
  readonly issueNumber: number
  readonly from: Label
  readonly to: Label
  readonly runId: string
}): Promise<void> {
  if (!canTransition(input.from, input.to)) {
    throw new RegistryError(
      `Illegal label transition ${input.from} → ${input.to} on issue #${input.issueNumber}`,
    )
  }

  await input.github.setLabels(input.issueNumber, { add: [input.to], remove: [input.from] })
  input.journal.append({
    run_id: input.runId,
    event: 'label.changed',
    issue: input.issueNumber,
    data: { from: input.from, to: input.to },
  })
}

export async function claimRun(input: {
  readonly github: RegistryGitHub
  readonly journal: RegistryJournal
  readonly issue: GithubIssue
  readonly runId: string
}): Promise<ClaimOutcome> {
  const comments = await input.github.listComments(input.issue.number)
  const liveMarker = latestRunMarker(comments)
  const currentLabels = input.issue.labels.map((label) => label.name)

  if (liveMarker !== null) {
    // A marker means the run already exists. If the label never moved, a prior
    // tick crashed between the marker and the move — finish it so the claim is
    // not left half-applied. Otherwise the run is live and a re-tick is a no-op.
    if (!currentLabels.includes(LABELS.ready)) return { kind: 'already-live', runId: liveMarker.runId }

    await transition({
      github: input.github,
      journal: input.journal,
      issueNumber: input.issue.number,
      from: LABELS.ready,
      to: LABELS.inProgress,
      runId: liveMarker.runId,
    })
    input.journal.append({ run_id: liveMarker.runId, event: 'run.resumed', issue: input.issue.number })
    return { kind: 'resumed', runId: liveMarker.runId }
  }

  if (!currentLabels.includes(LABELS.ready)) {
    throw new RegistryError(
      `Issue #${input.issue.number} cannot be claimed: it does not carry ${LABELS.ready}`,
    )
  }

  // Marker first, then the label move: a crash between the two leaves a
  // resumable state (marker present, label still `agent-ready`), whereas the
  // reverse would lose the claim entirely.
  await postRunMarker({
    github: input.github,
    journal: input.journal,
    issueNumber: input.issue.number,
    runId: input.runId,
  })
  await transition({
    github: input.github,
    journal: input.journal,
    issueNumber: input.issue.number,
    from: LABELS.ready,
    to: LABELS.inProgress,
    runId: input.runId,
  })
  input.journal.append({ run_id: input.runId, event: 'run.claimed', issue: input.issue.number })
  return { kind: 'claimed', runId: input.runId }
}

export async function reclaimStaleRun(input: {
  readonly github: RegistryGitHub
  readonly journal: RegistryJournal
  readonly issue: GithubIssue
  readonly now?: () => Date
  readonly reclaimAfterMinutes?: number
}): Promise<ReclaimOutcome> {
  const currentLabels = input.issue.labels.map((label) => label.name)
  // Only an in-flight run can stall. `needs-human-plan-approval` is waiting on
  // a person by design and must never be reclaimed.
  if (!currentLabels.includes(LABELS.inProgress)) return { kind: 'not-in-flight' }

  const marker = latestRunMarker(await input.github.listComments(input.issue.number))
  if (marker === null) return { kind: 'not-in-flight' }

  const now = (input.now ?? (() => new Date()))()
  const reclaimAfterMinutes = input.reclaimAfterMinutes ?? DEFAULT_RECLAIM_AFTER_MINUTES
  const ageMinutes = (now.getTime() - Date.parse(marker.createdAt)) / 60_000
  if (ageMinutes < reclaimAfterMinutes) return { kind: 'live', runId: marker.runId }

  // Escalate rather than silently re-arm: a stalled run means the tick died or
  // Pi hung, which a human should see. Re-adding `agent-ready` from the bot
  // would also erase the human-only provenance the SEC2 check relies on.
  await transition({
    github: input.github,
    journal: input.journal,
    issueNumber: input.issue.number,
    from: LABELS.inProgress,
    to: LABELS.needsHuman,
    runId: marker.runId,
  })
  await input.github.postComment(
    input.issue.number,
    `${markerFor(marker.runId)}\n\nThe agent run stalled in ${LABELS.inProgress} for over ${reclaimAfterMinutes} minutes and was marked ${LABELS.needsHuman}.`,
  )
  input.journal.append({
    run_id: marker.runId,
    event: 'run.reclaimed',
    issue: input.issue.number,
    data: { reclaimAfterMinutes },
  })
  return { kind: 'reclaimed', runId: marker.runId }
}

// The whole single-slot claim: pick the oldest ready issue whose trigger is
// trusted, then claim it. An untrusted trigger is skipped, never actioned
// (SEC2); a null result means there was nothing to do this tick.
export async function claimNextRun(deps: RegistryDeps): Promise<ClaimOutcome | null> {
  const issues = await findAgentReadyIssues(deps.github)

  for (const issue of issues) {
    try {
      await assertTrustedActor(deps.github, issue)
    } catch (failure) {
      if (failure instanceof RegistryError) continue
      throw failure
    }

    const runId = (deps.generateRunId ?? (() => generateRunId(deps.now)))()
    return claimRun({ github: deps.github, journal: deps.journal, issue, runId })
  }

  return null
}
