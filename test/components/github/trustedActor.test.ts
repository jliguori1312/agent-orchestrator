// Tests for the SEC2 actor selector. It is pure: given the REST timeline it
// picks who most recently applied a given label, which is the only signal that
// authorizes an `agent-ready` trigger.
import { describe, expect, it } from 'vitest'
import type { GithubTimelineEvent } from '../../../src/components/github/githubSchemas.js'
import { latestLabelActor } from '../../../src/components/github/trustedActor.js'

function labeledEvent(login: string, createdAt: string, labelName = 'agent-ready'): GithubTimelineEvent {
  return { event: 'labeled', actor: { login }, label: { name: labelName }, created_at: createdAt }
}

describe('latestLabelActor', () => {
  it('returns the actor of the newest matching labeled event', () => {
    expect(
      latestLabelActor(
        [
          labeledEvent('first', '2026-10-11T08:00:00Z'),
          labeledEvent('second', '2026-10-11T09:00:00Z'),
        ],
        'agent-ready',
      ),
    ).toBe('second')
  })

  it('orders by timestamp, not array position', () => {
    expect(
      latestLabelActor(
        [
          labeledEvent('newer', '2026-10-11T09:00:00Z'),
          labeledEvent('older', '2026-10-11T08:00:00Z'),
        ],
        'agent-ready',
      ),
    ).toBe('newer')
  })

  it('ignores other events and other labels', () => {
    expect(
      latestLabelActor(
        [
          labeledEvent('bug-triager', '2026-10-11T09:00:00Z', 'bug'),
          { event: 'commented', actor: { login: 'passerby' }, created_at: '2026-10-11T10:00:00Z' },
        ],
        'agent-ready',
      ),
    ).toBeNull()
  })

  it('returns null when the label event has no actor', () => {
    expect(
      latestLabelActor(
        [{ event: 'labeled', actor: null, label: { name: 'agent-ready' }, created_at: '2026-10-11T09:00:00Z' }],
        'agent-ready',
      ),
    ).toBeNull()
  })

  it('returns null when no event applied the label', () => {
    expect(latestLabelActor([], 'agent-ready')).toBeNull()
  })
})
