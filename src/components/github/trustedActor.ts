// SEC2: a label only counts as a trigger when a collaborator applied it. The
// REST issue timeline records who applied each label; this selector picks the
// most recent application of a given label, so a stale earlier application
// cannot authorize a fresh trigger.
import type { GithubTimelineEvent } from './githubSchemas.js'

export function latestLabelActor(
  events: readonly GithubTimelineEvent[],
  labelName: string,
): string | null {
  let latest: { readonly createdAt: string; readonly login: string } | null = null

  for (const event of events) {
    if (event.event !== 'labeled') continue
    if (event.label?.name !== labelName) continue

    const login = event.actor?.login
    const createdAt = event.created_at
    // A labeled event without an actor or timestamp cannot be ordered or
    // attributed, so it cannot authorize anything.
    if (login === undefined || createdAt === undefined) continue

    if (latest === null || createdAt > latest.createdAt) latest = { createdAt, login }
  }

  return latest === null ? null : latest.login
}
