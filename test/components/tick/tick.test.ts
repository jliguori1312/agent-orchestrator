// Tests for the tick entrypoint (PR 7). Every boundary is faked, so each test
// drives the whole run with a scripted C2 client and session runner and asserts
// on the external effects: the claim, the sessions run, the posted comments,
// the label moves, and the journal records.
import { describe, expect, it } from 'vitest'
import { GitHubError } from '../../../src/components/github/githubError.js'
import type { GithubIssue } from '../../../src/components/github/githubSchemas.js'
import { LABELS } from '../../../src/components/registry/labels.js'
import { runTick } from '../../../src/components/tick/tick.js'
import { issue, markerComment } from '../registry/fixtures.js'
import { buildHarness, RUN_ID, sessionOutput } from './fixtures.js'

// The complete policy from docs/config-reference.md — parseRepoPolicy refuses a
// document missing any required section, so a tiers-only fixture would be
// (correctly) escalated as an unusable policy.
const ELIGIBLE_POLICY = [
  'tiers:',
  '  eligible: [0, 1, 2, 3]',
  'diff_budget:',
  '  max_lines: 300',
  '  max_files: 10',
  'protected_paths: scripts/agent/protected-paths.txt',
].join('\n')
const TRIAGE_ELIGIBLE = sessionOutput('Assessment.\n<!-- agent:tier=3 -->\n')
const PLAN = sessionOutput('## Plan\n\n1. Do the thing.')

function readyIssue(number = 42): Record<string, readonly GithubIssue[]> {
  return { [LABELS.ready]: [issue(number, [LABELS.ready])], [LABELS.inProgress]: [] }
}

describe('runTick', () => {
  it('idles when no issue is ready', async () => {
    const { deps, github, calls } = buildHarness({
      github: { issuesByLabel: { [LABELS.ready]: [], [LABELS.inProgress]: [] } },
      sessions: [],
    })

    await expect(runTick(deps)).resolves.toEqual({ kind: 'idle' })
    expect(calls).toEqual([])
    expect(github.postedComments).toEqual([])
    expect(github.labelChanges).toEqual([])
  })

  it('runs triage then plan and stops at needs-human-plan-approval', async () => {
    const { deps, github, records, calls } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
        repoFile: ELIGIBLE_POLICY,
      },
      sessions: [TRIAGE_ELIGIBLE, PLAN],
    })

    await expect(runTick(deps)).resolves.toEqual({
      kind: 'triaged',
      runId: RUN_ID,
      issueNumber: 42,
    })

    // Two read-only sessions in order, named and located per the run.
    expect(calls.map((spec) => spec.role.name)).toEqual(['triage', 'plan'])
    expect(calls.map((spec) => spec.sessionId)).toEqual([`${RUN_ID}-triage`, `${RUN_ID}-plan`])
    expect(calls[0]?.sessionDir).toBe(`/var/lib/agent-orchestrator/sessions/${RUN_ID}`)
    expect(calls[0]?.cwd).toBe('/var/lib/agent-orchestrator/repo')
    expect(calls[0]?.apiKey).toBe('provider-key')
    expect(calls[0]?.prompt).toContain('Issue #42')
    expect(calls[0]?.role.tools).toEqual(['read', 'grep', 'find', 'ls'])

    // The claim marker, then the plan comment carrying marker + mention + plan.
    expect(github.postedComments[0]?.body).toBe(`<!-- agent:run=${RUN_ID} -->`)
    expect(github.postedComments[1]?.body).toContain(`<!-- agent:run=${RUN_ID} -->`)
    expect(github.postedComments[1]?.body).toContain('@maintainer')
    expect(github.postedComments[1]?.body).toContain('## Plan')

    expect(github.labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.inProgress], remove: [LABELS.ready] },
      { issueNumber: 42, add: [LABELS.planApproval], remove: [LABELS.inProgress] },
    ])

    const events = records.map((record) => record.event)
    expect(events).toContain('triage.completed')
    expect(events).toContain('plan.completed')
    expect(events).toContain('notify.needs-human')
  })

  it('escalates an ineligible tier without planning', async () => {
    const { deps, github, records, calls } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
        repoFile: ELIGIBLE_POLICY,
      },
      sessions: [sessionOutput('Assessment.\n<!-- agent:tier=7 -->\n')],
    })

    await expect(runTick(deps)).resolves.toEqual({
      kind: 'escalated',
      runId: RUN_ID,
      issueNumber: 42,
      reason: 'ineligible-tier',
    })

    expect(calls.map((spec) => spec.role.name)).toEqual(['triage'])
    expect(github.labelChanges.at(-1)).toEqual({
      issueNumber: 42,
      add: [LABELS.needsHuman],
      remove: [LABELS.inProgress],
    })
    expect(github.postedComments.at(-1)?.body).toContain('tier 7')
    expect(github.postedComments.at(-1)?.body).toContain('@maintainer')
    expect(
      records.some(
        (record) => record.event === 'notify.needs-human' && record.data?.reason === 'ineligible-tier',
      ),
    ).toBe(true)
  })

  it('escalates an unclassifiable tier without fetching the policy', async () => {
    const { deps, github, calls } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
        repoFile: ELIGIBLE_POLICY,
      },
      sessions: [sessionOutput('Assessment with no tier marker.')],
    })

    await expect(runTick(deps)).resolves.toMatchObject({
      kind: 'escalated',
      reason: 'unclassified-tier',
    })

    expect(calls.map((spec) => spec.role.name)).toEqual(['triage'])
    expect(github.repoFileReads).toEqual([])
    expect(github.labelChanges.at(-1)).toEqual({
      issueNumber: 42,
      add: [LABELS.needsHuman],
      remove: [LABELS.inProgress],
    })
  })

  it('escalates when the repo policy is missing', async () => {
    const { deps, github, records } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
        repoFile: () => Promise.reject(new GitHubError('not found', 404)),
      },
      sessions: [TRIAGE_ELIGIBLE],
    })

    await expect(runTick(deps)).resolves.toMatchObject({
      kind: 'escalated',
      reason: 'policy-unavailable',
    })

    expect(github.repoFileReads).toEqual(['.github/agent.yml'])
    expect(github.postedComments.at(-1)?.body).toMatch(/policy/i)
    expect(
      records.some(
        (record) => record.event === 'policy.unavailable' && record.data?.cause === 'not-found',
      ),
    ).toBe(true)
  })

  it('escalates when the repo policy is malformed', async () => {
    const { deps, records } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
        // Valid YAML, invalid policy: the eligible list must not be empty.
        repoFile: 'tiers:\n  eligible: []\n',
      },
      sessions: [TRIAGE_ELIGIBLE],
    })

    await expect(runTick(deps)).resolves.toMatchObject({
      kind: 'escalated',
      reason: 'policy-unavailable',
    })

    expect(
      records.some(
        (record) => record.event === 'policy.unavailable' && record.data?.cause === 'invalid',
      ),
    ).toBe(true)
  })

  it('ignores a trigger from an untrusted actor (SEC2)', async () => {
    const { deps, github, calls } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'stranger' },
        collaborators: ['maintainer'],
      },
      sessions: [],
    })

    await expect(runTick(deps)).resolves.toEqual({ kind: 'idle' })
    expect(calls).toEqual([])
    expect(github.labelChanges).toEqual([])
  })

  it('reclaims a stalled in-progress run before claiming', async () => {
    const { deps, github } = buildHarness({
      github: {
        issuesByLabel: {
          [LABELS.inProgress]: [issue(50, [LABELS.inProgress])],
          [LABELS.ready]: [],
        },
        comments: { 50: [markerComment(RUN_ID, '2026-10-11T09:00:00Z')] },
      },
      sessions: [],
      now: () => new Date('2026-10-11T12:00:00Z'),
    })

    await expect(runTick(deps)).resolves.toEqual({ kind: 'idle' })
    expect(github.labelChanges).toEqual([
      { issueNumber: 50, add: [LABELS.needsHuman], remove: [LABELS.inProgress] },
    ])
    expect(github.postedComments[0]?.body).toContain('stalled')
  })

  it('journals run.failed and rethrows when a session crashes', async () => {
    const { deps, records } = buildHarness({
      github: {
        issuesByLabel: readyIssue(),
        labelledBy: { 42: 'maintainer' },
        collaborators: ['maintainer'],
      },
      sessions: [new Error('pi exited with code 1')],
    })

    await expect(runTick(deps)).rejects.toThrow('pi exited with code 1')
    expect(records.some((record) => record.event === 'run.failed')).toBe(true)
  })
})
