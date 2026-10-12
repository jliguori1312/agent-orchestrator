// Tests for the notifier (C15). The delivery channel is an @mention comment
// (ADR-0003), so the contract is: the composed body carries the run marker,
// the mention, and the reason; the post and the journal record say the same.
import { describe, expect, it } from 'vitest'
import type { JournalEventInput } from '../../../src/components/journal/journal.js'
import {
  composeNeedsHumanComment,
  notifyNeedsHuman,
  type NeedsHumanNotice,
  type NotifierGitHub,
  type NotifierJournal,
} from '../../../src/components/notifier/notifier.js'

const RUN_ID = '261011T090312Z-a3f2'

const INELIGIBLE_NOTICE: NeedsHumanNotice = {
  reason: 'ineligible-tier',
  tier: 7,
  runId: RUN_ID,
  issueNumber: 42,
  actor: 'maintainer',
}

const PLAN_BODY = '## Plan\n\n1. Do the thing.'

const PLAN_READY_NOTICE: NeedsHumanNotice = {
  reason: 'plan-ready',
  plan: PLAN_BODY,
  runId: RUN_ID,
  issueNumber: 42,
  actor: 'maintainer',
}

function createFakeNotifier(): {
  readonly github: NotifierGitHub
  readonly journal: NotifierJournal
  readonly posted: { readonly issueNumber: number; readonly body: string }[]
  readonly records: JournalEventInput[]
} {
  const posted: { issueNumber: number; body: string }[] = []
  const records: JournalEventInput[] = []

  return {
    github: {
      postComment: (issueNumber, body) => {
        posted.push({ issueNumber, body })
        return Promise.resolve()
      },
    },
    journal: { append: (input) => records.push(input) },
    posted,
    records,
  }
}

describe('composeNeedsHumanComment', () => {
  it('carries the run marker and @mentions the human in the loop', () => {
    const body = composeNeedsHumanComment(PLAN_READY_NOTICE)

    expect(body).toContain(`<!-- agent:run=${RUN_ID} -->`)
    expect(body).toContain('@maintainer')
    expect(body).toMatch(/plan is ready/i)
    // The plan comment itself is the notification, so the plan body is embedded.
    expect(body).toContain(PLAN_BODY)
  })

  it('marks an ineligible tier as not agent-eligible, naming the tier', () => {
    const body = composeNeedsHumanComment(INELIGIBLE_NOTICE)

    expect(body).toContain('tier 7')
    expect(body).toContain('security or sensitive')
    expect(body).toMatch(/not agent-eligible/i)
  })

  it('does not name a tier on an unclassified-tier notice', () => {
    const body = composeNeedsHumanComment({
      reason: 'unclassified-tier',
      runId: RUN_ID,
      issueNumber: 42,
      actor: 'maintainer',
    })

    expect(body).toMatch(/machine-readable tier/i)
    expect(body).not.toMatch(/tier \d/)
  })
})

describe('notifyNeedsHuman', () => {
  it('posts the composed comment and journals the notice', async () => {
    const { github, journal, posted, records } = createFakeNotifier()

    await notifyNeedsHuman({ github, journal, notice: INELIGIBLE_NOTICE })

    expect(posted).toEqual([
      { issueNumber: 42, body: composeNeedsHumanComment(INELIGIBLE_NOTICE) },
    ])
    expect(records).toEqual([
      {
        run_id: RUN_ID,
        event: 'notify.needs-human',
        issue: 42,
        data: { reason: 'ineligible-tier', actor: 'maintainer', tier: 7 },
      },
    ])
  })

  it('omits the tier from the journal for reasons that have none', async () => {
    const { github, journal, records } = createFakeNotifier()

    await notifyNeedsHuman({ github, journal, notice: PLAN_READY_NOTICE })

    expect(records).toEqual([
      {
        run_id: RUN_ID,
        event: 'notify.needs-human',
        issue: 42,
        data: { reason: 'plan-ready', actor: 'maintainer' },
      },
    ])
  })
})
