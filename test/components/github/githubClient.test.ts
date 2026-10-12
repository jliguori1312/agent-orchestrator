// Tests for the `gh`-driven GitHub adapter (C2, part 2). Every case scripts the
// gh boundary, so nothing here touches the network or a real repo. The
// retry cases are the token-expiry contract: a 401/403 refreshes once and
// succeeds, a second 401 does not loop, and a non-auth failure never refreshes.
import { describe, expect, it } from 'vitest'
import { GitHubError } from '../../../src/components/github/githubError.js'
import {
  createGitHubClient,
  type GitHubClient,
} from '../../../src/components/github/githubClient.js'
import type { GhResult } from '../../../src/components/github/ghRunner.js'
import {
  commentPayload,
  issuePayload,
  pullRequestPayload,
  timelinePayload,
} from './fixtures.js'
import { createGhStub, errorResponse, httpErrorResponse, okResponse } from './ghStub.js'

interface TestClient {
  readonly client: GitHubClient
  readonly ghCalls: { readonly args: readonly string[]; readonly token: string }[]
  readonly tokenCalls: string[]
}

function createTestClient(responses: readonly GhResult[], tokens: readonly string[]): TestClient {
  const { spawn, calls } = createGhStub(responses)
  const tokenCalls: string[] = []
  let nextIndex = 0
  const obtainToken = (): Promise<string> => {
    const token = tokens[nextIndex] ?? tokens.at(-1) ?? ''
    nextIndex += 1
    tokenCalls.push(token)
    return Promise.resolve(token)
  }
  const client = createGitHubClient({ repo: 'octo/widgets', obtainToken, spawn })
  return { client, ghCalls: calls, tokenCalls }
}

describe('read operations', () => {
  it('reads one issue and returns the parsed shape', async () => {
    const { client, ghCalls } = createTestClient([okResponse(JSON.stringify(issuePayload))], ['ghs_one'])

    await expect(client.getIssue(42)).resolves.toMatchObject({ number: 42, title: 'Fix the widget' })
    expect(ghCalls[0]?.args).toEqual(['api', 'repos/octo/widgets/issues/42'])
  })

  it('lists open issues by label and drops pull requests', async () => {
    const { client, ghCalls } = createTestClient(
      [okResponse(JSON.stringify([issuePayload, pullRequestPayload]))],
      ['ghs_one'],
    )

    const issues = await client.listIssuesByLabel('agent-ready')

    expect(issues.map((issue) => issue.number)).toEqual([42])
    expect(ghCalls[0]?.args[1]).toBe(
      'repos/octo/widgets/issues?labels=agent-ready&state=open&per_page=100',
    )
  })

  it('reads the comments on an issue', async () => {
    const { client, ghCalls } = createTestClient(
      [okResponse(JSON.stringify([commentPayload]))],
      ['ghs_one'],
    )

    await expect(client.listComments(42)).resolves.toEqual([commentPayload])
    expect(ghCalls[0]?.args[1]).toBe('repos/octo/widgets/issues/42/comments?per_page=100')
  })

  it('finds the latest label actor on the issue timeline', async () => {
    const { client, ghCalls } = createTestClient(
      [okResponse(JSON.stringify(timelinePayload))],
      ['ghs_one'],
    )

    await expect(client.lastLabelActor(42, 'agent-ready')).resolves.toBe('owner')
    expect(ghCalls[0]?.args[1]).toBe('repos/octo/widgets/issues/42/timeline?per_page=100')
  })
})

describe('write operations', () => {
  it('posts a comment through gh issue comment', async () => {
    const { client, ghCalls } = createTestClient([okResponse('https://github.com/...')], ['ghs_one'])

    await client.postComment(42, '<!-- agent:run=261011T090312Z-a3f2 -->')

    expect(ghCalls[0]?.args).toEqual([
      'issue',
      'comment',
      '42',
      '--repo',
      'octo/widgets',
      '--body',
      '<!-- agent:run=261011T090312Z-a3f2 -->',
    ])
  })

  it('moves labels with a single gh issue edit', async () => {
    const { client, ghCalls } = createTestClient([okResponse('')], ['ghs_one'])

    await client.setLabels(42, { add: ['agent-in-progress'], remove: ['agent-ready'] })

    expect(ghCalls[0]?.args).toEqual([
      'issue',
      'edit',
      '42',
      '--repo',
      'octo/widgets',
      '--add-label',
      'agent-in-progress',
      '--remove-label',
      'agent-ready',
    ])
  })

  it('does not call gh when there is no label change', async () => {
    const { client, ghCalls } = createTestClient([], ['ghs_one'])

    await client.setLabels(42, { add: [], remove: [] })

    expect(ghCalls).toHaveLength(0)
  })
})

describe('installation-token handling', () => {
  it('reuses one installation token across calls', async () => {
    const { client, ghCalls, tokenCalls } = createTestClient(
      [okResponse(JSON.stringify(issuePayload)), okResponse(JSON.stringify(issuePayload))],
      ['ghs_one'],
    )

    await client.getIssue(42)
    await client.getIssue(42)

    expect(tokenCalls).toEqual(['ghs_one'])
    expect(ghCalls.map((call) => call.token)).toEqual(['ghs_one', 'ghs_one'])
  })

  it('refreshes the token and retries once on a 401', async () => {
    const { client, ghCalls, tokenCalls } = createTestClient(
      [httpErrorResponse(401, 'Bad credentials'), okResponse(JSON.stringify(issuePayload))],
      ['expired_token', 'fresh_token'],
    )

    await expect(client.getIssue(42)).resolves.toMatchObject({ number: 42 })

    expect(ghCalls.map((call) => call.token)).toEqual(['expired_token', 'fresh_token'])
    expect(tokenCalls).toEqual(['expired_token', 'fresh_token'])
  })

  it('refreshes the token and retries once on a 403', async () => {
    const { client, ghCalls } = createTestClient(
      [
        httpErrorResponse(403, 'Resource not accessible by integration'),
        okResponse(JSON.stringify(issuePayload)),
      ],
      ['expired_token', 'fresh_token'],
    )

    await expect(client.getIssue(42)).resolves.toMatchObject({ number: 42 })
    expect(ghCalls).toHaveLength(2)
  })

  it('does not retry a second time', async () => {
    const { client, ghCalls } = createTestClient(
      [httpErrorResponse(401, 'Bad credentials'), httpErrorResponse(401, 'Bad credentials')],
      ['first_token', 'second_token'],
    )

    await expect(client.getIssue(42)).rejects.toThrow(GitHubError)
    expect(ghCalls).toHaveLength(2)
  })

  it('does not refresh on a non-auth failure', async () => {
    const { client, ghCalls, tokenCalls } = createTestClient(
      [errorResponse(1, 'HTTP 422: Validation Failed')],
      ['only_token'],
    )

    await expect(client.getIssue(42)).rejects.toThrow(GitHubError)
    expect(ghCalls).toHaveLength(1)
    expect(tokenCalls).toEqual(['only_token'])
  })
})

describe('isCollaborator', () => {
  it('returns true when gh exits zero', async () => {
    const { client } = createTestClient([okResponse('')], ['ghs_one'])

    await expect(client.isCollaborator('maintainer')).resolves.toBe(true)
  })

  it('returns false on a 404', async () => {
    const { client } = createTestClient([httpErrorResponse(404, 'Not Found')], ['ghs_one'])

    await expect(client.isCollaborator('stranger')).resolves.toBe(false)
  })

  it('throws on any other failure', async () => {
    const { client } = createTestClient([httpErrorResponse(500, 'Server Error')], ['ghs_one'])

    await expect(client.isCollaborator('maintainer')).rejects.toThrow(GitHubError)
  })

  it('refreshes the token and retries on a 401', async () => {
    const { client, ghCalls } = createTestClient(
      [httpErrorResponse(401, 'Bad credentials'), okResponse('')],
      ['expired_token', 'fresh_token'],
    )

    await expect(client.isCollaborator('maintainer')).resolves.toBe(true)
    expect(ghCalls.map((call) => call.token)).toEqual(['expired_token', 'fresh_token'])
  })
})
