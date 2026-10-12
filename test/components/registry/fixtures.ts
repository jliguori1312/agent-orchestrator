// Shared fixtures for the run-registry tests: a small stateful fake for the C2
// client and an in-memory journal, so each test states only the issue, labels,
// and comments it cares about.
import type { GithubComment, GithubIssue } from '../../../src/components/github/githubSchemas.js'
import type { JournalEventInput } from '../../../src/components/journal/journal.js'
import type { RegistryGitHub, RegistryJournal } from '../../../src/components/registry/runRegistry.js'

export const RUN_ID = '261011T090312Z-a3f2'
export const OTHER_RUN_ID = '261011T100000Z-b1c2'

export function issue(number: number, labels: readonly string[]): GithubIssue {
  return {
    number,
    title: `Issue ${number}`,
    body: `Description of issue ${number}.`,
    state: 'open',
    labels: labels.map((name) => ({ name })),
    user: { login: 'reporter' },
  }
}

export function markerComment(runId: string, createdAt: string): GithubComment {
  return {
    id: 1,
    body: `<!-- agent:run=${runId} -->`,
    created_at: createdAt,
    user: { login: 'agent-orchestrator[bot]' },
  }
}

export interface LabelChangeCall {
  readonly issueNumber: number
  readonly add: readonly string[]
  readonly remove: readonly string[]
}

export interface PostedComment {
  readonly issueNumber: number
  readonly body: string
}

export interface FakeGitHub {
  readonly github: RegistryGitHub
  readonly labelChanges: LabelChangeCall[]
  readonly postedComments: PostedComment[]
}

export function createFakeGitHub(options: {
  readonly issues?: readonly GithubIssue[]
  readonly comments?: Record<number, readonly GithubComment[]>
  readonly collaborators?: readonly string[]
  readonly labelledBy?: Record<number, string | null>
}): FakeGitHub {
  const labelChanges: LabelChangeCall[] = []
  const postedComments: PostedComment[] = []

  const github: RegistryGitHub = {
    listIssuesByLabel: (label) =>
      Promise.resolve(
        (options.issues ?? []).filter((candidate) =>
          candidate.labels.some((item) => item.name === label),
        ),
      ),
    listComments: (issueNumber) => Promise.resolve([...(options.comments?.[issueNumber] ?? [])]),
    postComment: (issueNumber, body) => {
      postedComments.push({ issueNumber, body })
      return Promise.resolve()
    },
    setLabels: (issueNumber, change) => {
      labelChanges.push({ issueNumber, add: change.add, remove: change.remove })
      return Promise.resolve()
    },
    lastLabelActor: (issueNumber) => Promise.resolve(options.labelledBy?.[issueNumber] ?? null),
    isCollaborator: (login) => Promise.resolve((options.collaborators ?? []).includes(login)),
  }

  return { github, labelChanges, postedComments }
}

export function createJournalStub(): { journal: RegistryJournal; records: JournalEventInput[] } {
  const records: JournalEventInput[] = []
  return {
    journal: {
      append: (input) => {
        records.push(input)
      },
    },
    records,
  }
}
