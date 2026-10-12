// Mints the short-lived JWT that authenticates the orchestrator as the GitHub
// App itself (ADR-0003); the JWT is then exchanged for an installation token.
// Signing is pure RS256 over node:crypto, so no JWT dependency is needed.
import { createPrivateKey, createSign } from 'node:crypto'
import { GitHubError } from './githubError.js'

// GitHub's documented JWT bounds: `iat` may sit up to 60 seconds in the past
// (clock skew) and `exp` may sit up to 10 minutes in the future. Nine minutes
// keeps a margin on the future bound while still giving the token a useful
// life across a tick's multiple GitHub calls.
const ISSUED_AT_SKEW_SECONDS = 60
const EXPIRES_AFTER_SECONDS = 540

export interface MintAppJwtInput {
  // PEM (PKCS#1 or PKCS#8), exactly as readCredential returns it.
  readonly privateKey: string
  // Digit-only GitHub App ID; hostConfigSchema already guarantees the form.
  readonly appId: string
  // Injectable for deterministic tests; the default is the real clock.
  readonly now?: () => Date
}

export function mintAppJwt(input: MintAppJwtInput): string {
  const nowSeconds = Math.floor((input.now ?? (() => new Date()))().getTime() / 1000)

  const headerSegment = encodeSegment({ alg: 'RS256', typ: 'JWT' })
  const payloadSegment = encodeSegment({
    iat: nowSeconds - ISSUED_AT_SKEW_SECONDS,
    exp: nowSeconds + EXPIRES_AFTER_SECONDS,
    iss: input.appId,
  })
  const signedContent = `${headerSegment}.${payloadSegment}`

  // A bad or empty PEM is a credential problem surfaced here as a GitHubError;
  // there is no meaningful value to return.
  let signature: Buffer
  try {
    const signer = createSign('RSA-SHA256')
    signer.update(signedContent)
    signature = signer.sign(createPrivateKey(input.privateKey))
  } catch (signFailure) {
    throw new GitHubError(`Cannot sign the GitHub App JWT: ${describeFailure(signFailure)}`)
  }

  // base64url (RFC 7515) is unpadded; Node's 'base64url' encoding produces
  // exactly that, so the encoding is the whole implementation.
  return `${signedContent}.${signature.toString('base64url')}`
}

// JWT segments are the unpadded base64url of the UTF-8 JSON value.
function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
