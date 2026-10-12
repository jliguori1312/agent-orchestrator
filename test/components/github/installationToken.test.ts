// Boundary tests for the JWT → installation-token exchange (ADR-0003). `fetch`
// is injected, so every case is a canned response and no test touches the
// network. The contract under test is the request we build and the response we
// accept.
import { describe, expect, it } from 'vitest'
import { GitHubError } from '../../../src/components/github/githubError.js'
import { requestInstallationToken } from '../../../src/components/github/installationToken.js'
import { validTokenResponse } from './fixtures.js'

describe('requestInstallationToken', () => {
  interface StubResponse {
    readonly ok: boolean
    readonly status: number
    readonly json?: () => Promise<unknown>
    readonly text?: () => Promise<string>
  }

  // A stub standing in for global fetch: it records the call and replays a
  // canned response. Bodies are resolved (not `async`) so the lint rule
  // against async functions without await does not fire on a test double.
  function stubFetch(response: StubResponse) {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchImpl = ((input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Promise.resolve({
        text: () => Promise.resolve(''),
        json: () => Promise.resolve(undefined),
        ...response,
      } as unknown as Response)
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  async function captureGitHubError(action: () => Promise<unknown>): Promise<GitHubError> {
    try {
      await action()
      throw new Error('expected the action to reject with GitHubError')
    } catch (failure) {
      if (failure instanceof GitHubError) return failure
      throw failure
    }
  }

  const input = {
    jwt: 'header.payload.signature',
    installationId: '789012',
  }

  it('POSTs the JWT to the installation access-tokens endpoint with the documented headers', async () => {
    const { fetchImpl, calls } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve(validTokenResponse),
    })

    await requestInstallationToken({ ...input, fetchImpl })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.github.com/app/installations/789012/access_tokens')
    expect(call?.init?.method).toBe('POST')
    expect(call?.init?.headers).toEqual({
      Authorization: 'Bearer header.payload.signature',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
  })

  it('returns the token and expiry, ignoring response fields we do not consume', async () => {
    const { fetchImpl } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve(validTokenResponse),
    })

    await expect(requestInstallationToken({ ...input, fetchImpl })).resolves.toEqual({
      token: 'ghs_fakeinstallationtoken',
      expiresAt: '2026-10-11T10:03:12Z',
    })
  })

  it('honours an explicit API base URL', async () => {
    const { fetchImpl, calls } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve(validTokenResponse),
    })

    await requestInstallationToken({
      ...input,
      apiUrl: 'https://github.example.com/api/v3',
      fetchImpl,
    })

    expect(calls[0]?.url).toBe(
      'https://github.example.com/api/v3/app/installations/789012/access_tokens',
    )
  })

  it('throws GitHubError naming the status on a non-2xx response', async () => {
    const { fetchImpl } = stubFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Bad credentials' }),
      text: () => Promise.resolve('{"message":"Bad credentials"}'),
    })

    const failure = await captureGitHubError(() => requestInstallationToken({ ...input, fetchImpl }))
    expect(failure.message).toContain('401')
  })

  it('throws GitHubError when the response body is not JSON', async () => {
    const { fetchImpl } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    })

    const failure = await captureGitHubError(() => requestInstallationToken({ ...input, fetchImpl }))
    expect(failure.message).toContain('non-JSON')
  })

  it('throws GitHubError naming the missing field when the payload is incomplete', async () => {
    const { fetchImpl } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ token: 'ghs_incomplete' }),
    })

    const failure = await captureGitHubError(() => requestInstallationToken({ ...input, fetchImpl }))
    expect(failure.message).toContain('expires_at')
  })
})
