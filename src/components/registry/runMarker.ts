// Every run-scoped comment carries the run id in an HTML comment (plan §6):
// invisible in rendered Markdown, machine-findable in the raw body. The marker
// doubles as the claim's idempotency token — its presence means the run exists.
import { RUN_ID_BODY_SOURCE } from '../journal/runId.js'

export const RUN_MARKER_PATTERN = new RegExp(`<!-- agent:run=(${RUN_ID_BODY_SOURCE}) -->`)

export function markerFor(runId: string): string {
  return `<!-- agent:run=${runId} -->`
}

export function extractRunId(body: string): string | null {
  return RUN_MARKER_PATTERN.exec(body)?.[1] ?? null
}

export interface RunMarker {
  readonly runId: string
  readonly createdAt: string
}

// The most recent marker across a set of comments. Several comments carry the
// same run id (the claim marker, then the plan comment), so only the newest
// matters; an empty or marker-free set is a run that has not claimed yet.
export function latestRunMarker(
  comments: readonly { readonly body: string; readonly created_at: string }[],
): RunMarker | null {
  let latest: RunMarker | null = null

  for (const comment of comments) {
    const runId = extractRunId(comment.body)
    if (runId === null) continue

    if (latest === null || comment.created_at > latest.createdAt) {
      latest = { runId, createdAt: comment.created_at }
    }
  }

  return latest
}
