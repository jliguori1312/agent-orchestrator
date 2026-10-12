// Shared fixtures for the GitHub App auth tests. The signing key is generated
// at test time and never committed, so the secret scanner has nothing to flag
// and no test depends on a fixture file on disk. It is exported as PEM because
// that is exactly the string readCredential hands to mintAppJwt on the host.
import { generateKeyPairSync } from 'node:crypto'

const testKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 })

export const testPrivateKeyPem = testKeyPair.privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString()
export const testPublicKeyPem = testKeyPair.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString()

// A complete, successful access-token response as GitHub returns it — extra
// fields included, because the adapter must ignore fields it does not consume.
export const validTokenResponse = {
  token: 'ghs_fakeinstallationtoken',
  expires_at: '2026-10-11T10:03:12Z',
  permissions: { issues: 'write', contents: 'write' },
  repository_selection: 'selected',
}

// Decodes one JWT segment back to its JSON value. The tests use this instead
// of a JWT library so the assertions stay on the wire format we actually
// produce (unpadded base64url of UTF-8 JSON).
export function decodeJwtSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}
