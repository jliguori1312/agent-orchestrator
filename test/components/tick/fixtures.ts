// Shared fixtures for the tick tests: a real HostConfig parsed from the config
// fixture, one stateful fake carrying the union of C2 methods the tick calls,
// an in-memory journal, and a scripted session runner. buildHarness wires all
// four together so each test states only the issue, policy, and session output
// it cares about.
import type { AgentSessionResult, AgentSessionSpec } from '../../../src/components/agent/agentDriver.js'
import { hostConfigSchema, type HostConfig } from '../../../src/components/config/hostConfigSchema.js'
import { GitHubError } from '../../../src/components/github/githubError.js'
import type { GithubComment, GithubIssue } from '../../../src/components/github/githubSchemas.js'
import type { JournalEventInput } from '../../../src/components/journal/journal.js'
import type { RunSession, TickDeps, TickGitHub, TickJournal } from '../../../src/components/tick/tick.js'
import { validHostConfig } from '../config/fixtures.js'

export const RUN_ID = '261011T090312Z-a3f2'

export function hostConfig(): HostConfig {
  return hostConfigSchema.parse(validHostConfig)
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

export interface FakeTickGitHubOptions {
  readonly issuesByLabel?: Record<string, readonly GithubIssue[]>
  readonly comments?: Record<number, readonly GithubComment[]>
  readonly collaborators?: readonly string[]
  readonly labelledBy?: Record<number, string | null>
  // A string is the file text; a function lets a test reject (e.g. a 404).
  readonly repoFile?: string | (() => Promise<string>)
}

export interface FakeTickGitHub {
  readonly github: TickGitHub
  readonly labelChanges: LabelChangeCall[]
  readonly postedComments: PostedComment[]
  readonly repoFileReads: string[]
}

export function createFakeTickGitHub(options: FakeTickGitHubOptions): FakeTickGitHub {
  const labelChanges: LabelChangeCall[] = []
  const postedComments: PostedComment[] = []
  const repoFileReads: string[] = []

  const github: TickGitHub = {
    listIssuesByLabel: (label) => Promise.resolve([...(options.issuesByLabel?.[label] ?? [])]),
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
    getRepoFile: (path) => {
      repoFileReads.push(path)
      if (typeof options.repoFile === 'function') return options.repoFile()
      if (options.repoFile === undefined) {
        return Promise.reject(new GitHubError(`no file at ${path}`, 404))
      }
      return Promise.resolve(options.repoFile)
    },
  }

  return { github, labelChanges, postedComments, repoFileReads }
}

export function createJournalStub(): { journal: TickJournal; records: JournalEventInput[] } {
  const records: JournalEventInput[] = []
  return {
    journal: { append: (input) => records.push(input) },
    records,
  }
}

export interface SessionStub {
  readonly runSession: RunSession
  readonly calls: AgentSessionSpec[]
}

// Replays queued results in order; an Error entry rejects, so a crash path can
// be scripted. Running out of results is a test bug, so it throws.
export function createSessionStub(results: readonly (AgentSessionResult | Error)[]): SessionStub {
  const calls: AgentSessionSpec[] = []
  let nextIndex = 0

  const runSession: RunSession = (spec) => {
    calls.push(spec)
    const result = results[nextIndex]
    nextIndex += 1
    if (result === undefined) {
      throw new Error(`session stub ran out of responses at call ${nextIndex}`)
    }
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
  }

  return { runSession, calls }
}

export function sessionOutput(output: string): AgentSessionResult {
  return { output, sessionFile: `/sessions/${RUN_ID}.jsonl` }
}

export interface TickHarness {
  readonly deps: TickDeps
  readonly github: FakeTickGitHub
  readonly records: JournalEventInput[]
  readonly calls: AgentSessionSpec[]
}

export function buildHarness(options: {
  readonly github: FakeTickGitHubOptions
  readonly sessions: readonly (AgentSessionResult | Error)[]
  readonly now?: () => Date
}): TickHarness {
  const github = createFakeTickGitHub(options.github)
  const { journal, records } = createJournalStub()
  const { runSession, calls } = createSessionStub(options.sessions)

  const deps: TickDeps = {
    github: github.github,
    journal,
    config: hostConfig(),
    runSession,
    readProviderKey: () => 'provider-key',
    generateRunId: () => RUN_ID,
    now: options.now,
  }

  return { deps, github, records, calls }
}
