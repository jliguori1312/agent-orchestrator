// Unit tests for the GitHub App JWT (ADR-0003). Signing is pure node:crypto,
// so the whole suite is deterministic: the injected clock pins iat/exp and the
// generated test key makes the signature independently verifiable.
import { createVerify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { mintAppJwt } from '../../../src/components/github/appJwt.js'
import { GitHubError } from '../../../src/components/github/githubError.js'
import { decodeJwtSegment, testPrivateKeyPem, testPublicKeyPem } from './fixtures.js'

describe('mintAppJwt', () => {
  const octoberClock = () => new Date('2026-10-11T09:03:12.482Z')

  // Seconds since epoch, rounded down — iat/exp are integer seconds per the
  // JWT spec and GitHub's documented bounds.
  const nowSeconds = Math.floor(octoberClock().getTime() / 1000)

  it('produces three unpadded base64url segments', () => {
    const jwt = mintAppJwt({ privateKey: testPrivateKeyPem, appId: '123456', now: octoberClock })
    const segments = jwt.split('.')

    expect(segments).toHaveLength(3)
    for (const segment of segments) {
      expect(segment).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('carries the RS256 header and the app id as issuer within GitHub\u2019s bounds', () => {
    const jwt = mintAppJwt({ privateKey: testPrivateKeyPem, appId: '123456', now: octoberClock })
    const [headerSegment, payloadSegment] = jwt.split('.')

    expect(decodeJwtSegment(headerSegment ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' })
    // iat 60s in the past (clock skew) and exp 9 minutes in the future: both
    // inside GitHub's 60s-past / 10-minutes-future JWT constraints.
    expect(decodeJwtSegment(payloadSegment ?? '')).toEqual({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: '123456',
    })
  })

  it('signs the header and payload so the signature verifies against the public key', () => {
    // Re-derive the signed content and check the signature against the public
    // half — a JWT that merely looks right would fail this.
    const jwt = mintAppJwt({ privateKey: testPrivateKeyPem, appId: '123456', now: octoberClock })
    const [headerSegment, payloadSegment, signatureSegment] = jwt.split('.')
    const signature = Buffer.from(signatureSegment ?? '', 'base64url')

    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${headerSegment}.${payloadSegment}`)

    expect(verifier.verify(testPublicKeyPem, signature)).toBe(true)
  })

  it('throws GitHubError when the private key is not a usable PEM', () => {
    for (const brokenKey of ['', 'not a pem']) {
      expect(() => mintAppJwt({ privateKey: brokenKey, appId: '123456', now: octoberClock })).toThrow(
        GitHubError,
      )
    }
  })
})
