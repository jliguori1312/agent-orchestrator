// Tests for the run registry (C3). Every case drives the fake C2 client, so the
// contract under test is the label move, the marker comment, and the journal
// record — the three things a claim actually does.
import { describe, expect, it } from 'vitest'
import { LABELS } from '../../../src/components/registry/labels.js'
import { RegistryError } from '../../../src/components/registry/registryError.js'
import {
  assertTrustedActor,
  claimNextRun,
  claimRun,
  reclaimStaleRun,
  transition,
} from '../../../src/components/registry/runRegistry.js'
import {
  createFakeGitHub,
  createJournalStub,
  issue,
  markerComment,
  OTHER_RUN_ID,
  RUN_ID,
} from './fixtures.js'

describe('claimRun', () => {
  it('posts the run marker then moves agent-ready to agent-in-progress', async () => {
    const { github, labelChanges, postedComments } = createFakeGitHub({})
    const { journal, records } = createJournalStub()

    const outcome = await claimRun({
      github,
      journal,
      issue: issue(42, [LABELS.ready]),
      runId: RUN_ID,
    })

    expect(outcome).toEqual({ kind: 'claimed', runId: RUN_ID })
    expect(postedComments).toEqual([{ issueNumber: 42, body: `<!-- agent:run=${RUN_ID} -->` }])
    expect(labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.inProgress], remove: [LABELS.ready] },
    ])
    expect(records.map((record) => record.event)).toEqual([
      'run.marker-posted',
      'label.changed',
      'run.claimed',
    ])
    expect(records.every((record) => record.run_id === RUN_ID)).toBe(true)
  })

  it('is a no-op when a live run already holds the issue', async () => {
    const { github, labelChanges, postedComments } = createFakeGitHub({
      comments: { 42: [markerComment(RUN_ID, '2026-10-11T09:03:12Z')] },
    })
    const { journal } = createJournalStub()

    const outcome = await claimRun({
      github,
      journal,
      issue: issue(42, [LABELS.inProgress]),
      runId: OTHER_RUN_ID,
    })

    expect(outcome).toEqual({ kind: 'already-live', runId: RUN_ID })
    expect(labelChanges).toEqual([])
    expect(postedComments).toEqual([])
  })

  it('resumes a half-applied claim (marker present, label not yet moved)', async () => {
    const { github, labelChanges, postedComments } = createFakeGitHub({
      comments: { 42: [markerComment(RUN_ID, '2026-10-11T09:03:12Z')] },
    })
    const { journal, records } = createJournalStub()

    const outcome = await claimRun({
      github,
      journal,
      issue: issue(42, [LABELS.ready]),
      runId: OTHER_RUN_ID,
    })

    expect(outcome).toEqual({ kind: 'resumed', runId: RUN_ID })
    expect(labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.inProgress], remove: [LABELS.ready] },
    ])
    expect(postedComments).toEqual([])
    expect(records.map((record) => record.event)).toContain('run.resumed')
  })

  it('refuses an issue that does not carry agent-ready', async () => {
    const { github, labelChanges } = createFakeGitHub({})
    const { journal } = createJournalStub()

    await expect(
      claimRun({ github, journal, issue: issue(42, [LABELS.needsHuman]), runId: RUN_ID }),
    ).rejects.toThrow(RegistryError)
    expect(labelChanges).toEqual([])
  })
})

describe('transition', () => {
  it('moves a legal label pair and journals it', async () => {
    const { github, labelChanges } = createFakeGitHub({})
    const { journal, records } = createJournalStub()

    await transition({
      github,
      journal,
      issueNumber: 42,
      from: LABELS.ready,
      to: LABELS.inProgress,
      runId: RUN_ID,
    })

    expect(labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.inProgress], remove: [LABELS.ready] },
    ])
    expect(records).toEqual([
      {
        run_id: RUN_ID,
        event: 'label.changed',
        issue: 42,
        data: { from: LABELS.ready, to: LABELS.inProgress },
      },
    ])
  })

  it('refuses an illegal transition without touching labels', async () => {
    const { github, labelChanges } = createFakeGitHub({})
    const { journal } = createJournalStub()

    await expect(
      transition({
        github,
        journal,
        issueNumber: 42,
        from: LABELS.ready,
        to: LABELS.planApproval,
        runId: RUN_ID,
      }),
    ).rejects.toThrow(RegistryError)
    expect(labelChanges).toEqual([])
  })
})

describe('assertTrustedActor', () => {
  it('returns the collaborator who applied agent-ready', async () => {
    const { github } = createFakeGitHub({
      labelledBy: { 42: 'maintainer' },
      collaborators: ['maintainer'],
    })

    await expect(assertTrustedActor(github, issue(42, [LABELS.ready]))).resolves.toBe('maintainer')
  })

  it('refuses an untrusted actor (SEC2)', async () => {
    const { github } = createFakeGitHub({
      labelledBy: { 42: 'stranger' },
      collaborators: ['maintainer'],
    })

    await expect(assertTrustedActor(github, issue(42, [LABELS.ready]))).rejects.toThrow(
      /untrusted actor/,
    )
  })

  it('refuses when the timeline records no labeller', async () => {
    const { github } = createFakeGitHub({ labelledBy: { 42: null } })

    await expect(assertTrustedActor(github, issue(42, [LABELS.ready]))).rejects.toThrow(
      RegistryError,
    )
  })
})

describe('reclaimStaleRun', () => {
  const now = () => new Date('2026-10-11T12:00:00Z')

  it('escalates a run stalled past the window to needs-human', async () => {
    const { github, labelChanges, postedComments } = createFakeGitHub({
      comments: { 42: [markerComment(RUN_ID, '2026-10-11T09:00:00Z')] },
    })
    const { journal, records } = createJournalStub()

    const outcome = await reclaimStaleRun({
      github,
      journal,
      issue: issue(42, [LABELS.inProgress]),
      now,
    })

    expect(outcome).toEqual({ kind: 'reclaimed', runId: RUN_ID })
    expect(labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.needsHuman], remove: [LABELS.inProgress] },
    ])
    expect(postedComments[0]?.body).toContain(`<!-- agent:run=${RUN_ID} -->`)
    expect(records.map((record) => record.event)).toContain('run.reclaimed')
  })

  it('leaves a run that is still within the window alone', async () => {
    const { github, labelChanges } = createFakeGitHub({
      comments: { 42: [markerComment(RUN_ID, '2026-10-11T11:59:00Z')] },
    })
    const { journal } = createJournalStub()

    await expect(
      reclaimStaleRun({ github, journal, issue: issue(42, [LABELS.inProgress]), now }),
    ).resolves.toEqual({ kind: 'live', runId: RUN_ID })
    expect(labelChanges).toEqual([])
  })

  it('ignores an issue waiting on a human plan approval', async () => {
    const { github, labelChanges } = createFakeGitHub({
      comments: { 42: [markerComment(RUN_ID, '2026-10-11T09:00:00Z')] },
    })
    const { journal } = createJournalStub()

    await expect(
      reclaimStaleRun({ github, journal, issue: issue(42, [LABELS.planApproval]), now }),
    ).resolves.toEqual({ kind: 'not-in-flight' })
    expect(labelChanges).toEqual([])
  })
})

describe('claimNextRun', () => {
  it('claims the oldest ready issue from a trusted actor', async () => {
    const { github, labelChanges } = createFakeGitHub({
      issues: [issue(50, [LABELS.ready]), issue(42, [LABELS.ready])],
      labelledBy: { 42: 'maintainer', 50: 'maintainer' },
      collaborators: ['maintainer'],
    })
    const { journal } = createJournalStub()

    const outcome = await claimNextRun({ github, journal, generateRunId: () => RUN_ID })

    expect(outcome).toEqual({ kind: 'claimed', runId: RUN_ID })
    expect(labelChanges).toEqual([
      { issueNumber: 42, add: [LABELS.inProgress], remove: [LABELS.ready] },
    ])
  })

  it('returns null when nothing is ready', async () => {
    const { github } = createFakeGitHub({ issues: [] })
    const { journal } = createJournalStub()

    await expect(claimNextRun({ github, journal })).resolves.toBeNull()
  })

  it('skips an untrusted trigger and claims the next trusted issue', async () => {
    const { github, labelChanges } = createFakeGitHub({
      issues: [issue(42, [LABELS.ready]), issue(43, [LABELS.ready])],
      labelledBy: { 42: 'stranger', 43: 'maintainer' },
      collaborators: ['maintainer'],
    })
    const { journal } = createJournalStub()

    const outcome = await claimNextRun({ github, journal, generateRunId: () => RUN_ID })

    expect(outcome).toEqual({ kind: 'claimed', runId: RUN_ID })
    expect(labelChanges).toEqual([
      { issueNumber: 43, add: [LABELS.inProgress], remove: [LABELS.ready] },
    ])
  })

  it('claims nothing when every trigger is untrusted', async () => {
    const { github, labelChanges } = createFakeGitHub({
      issues: [issue(42, [LABELS.ready])],
      labelledBy: { 42: 'stranger' },
      collaborators: [],
    })
    const { journal } = createJournalStub()

    await expect(claimNextRun({ github, journal })).resolves.toBeNull()
    expect(labelChanges).toEqual([])
  })
})
