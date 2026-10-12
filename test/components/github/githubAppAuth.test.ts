// Composition test for the App-auth path: the pieces PR 3 delivers must fit
// together end to end — read the key from the credentials directory, mint the
// JWT, and exchange it for an installation token. `fetch` is stubbed, so the
// test observes the exact request the orchestrator would send.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { obtainInstallationToken } from '../../../src/components/github/githubAppAuth.js'
import { GitHubError } from '../../../src/components/github/githubError.js'
import { readCredential } from '../../../src/shared/readCredential.js'
import { decodeJwtSegment, testPrivateKeyPem, validTokenResponse } from './fixtures.js'

describe('obtainInstallationToken', () => {
  let credentialsDirectory: string

  beforeEach(() => {
    credentialsDirectory = mkdtempSync(join(tmpdir(), 'orchestrator-github-auth-'))
  })

  afterEach(() => {
    rmSync(credentialsDirectory, { recursive: true, force: true })
  })

  const octoberClock = () => new Date('2026-10-11T09:03:12.482Z')

  function stubFetch(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchImpl = ((input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Promise.resolve({ text: () => Promise.resolve(''), ...response } as unknown as Response)
    }) as unknown as typeof fetch
    return { fetchImpl, calls }
  }

  it('reads the key, mints a JWT, and exchanges it for an installation token', async () => {
    writeFileSync(join(credentialsDirectory, 'app-key'), testPrivateKeyPem, 'utf8')
    const { fetchImpl, calls } = stubFetch({
      ok: true,
      status: 201,
      json: () => Promise.resolve(validTokenResponse),
    })

    const privateKey = readCredential('app-key', { credentialsDirectory })
    const token = await obtainInstallationToken({
      privateKey,
      appId: '123456',
      installationId: '789012',
      now: octoberClock,
      fetchImpl,
    })

    expect(token).toEqual({ token: 'ghs_fakeinstallationtoken', expiresAt: '2026-10-11T10:03:12Z' })

    // The bearer the exchange received must be the JWT this run just minted:
    // same header, same issuer.
    expect(calls).toHaveLength(1)
    const headers = calls[0]?.init?.headers as Record<string, string>
    const jwt = headers.Authorization?.replace('Bearer ', '') ?? ''
    const [headerSegment, payloadSegment] = jwt.split('.')
    expect(decodeJwtSegment(headerSegment ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decodeJwtSegment(payloadSegment ?? '')).toMatchObject({ iss: '123456' })
  })

  it('propagates a GitHubError when the exchange is refused', async () => {
    writeFileSync(join(credentialsDirectory, 'app-key'), testPrivateKeyPem, 'utf8')
    const { fetchImpl } = stubFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Bad credentials' }),
    })

    const privateKey = readCredential('app-key', { credentialsDirectory })

    await expect(
      obtainInstallationToken({
        privateKey,
        appId: '123456',
        installationId: '789012',
        now: octoberClock,
        fetchImpl,
      }),
    ).rejects.toThrow(GitHubError)
  })
})
