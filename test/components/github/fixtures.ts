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

// --- REST payload fixtures for the `gh` adapter tests ---

// An open issue carrying the trigger label, as REST /issues returns it.
export const issuePayload = {
  number: 42,
  title: 'Fix the widget',
  body: 'The widget wobbles when spun.',
  state: 'open',
  labels: [{ name: 'agent-ready' }],
  user: { login: 'octocat' },
}

// The same shape from /issues but for a pull request: the endpoint returns
// both, and the adapter must drop these.
export const pullRequestPayload = {
  number: 43,
  title: 'A pull request that looks like an issue',
  body: '',
  state: 'open',
  labels: [{ name: 'agent-ready' }],
  user: { login: 'octocat' },
  pull_request: { url: 'https://api.github.com/repos/octo/widgets/pulls/43' },
}

// A run-marker comment as REST /issues/{n}/comments returns it.
export const commentPayload = {
  id: 9001,
  body: '<!-- agent:run=261011T090312Z-a3f2 -->',
  created_at: '2026-10-11T09:03:12Z',
  user: { login: 'agent-orchestrator[bot]' },
}

// A /contents payload holding the base64-encoded policy text. GitHub wraps the
// base64 body at 60 characters; the embedded newline proves the adapter
// tolerates that wrapping rather than assuming a single line.
export const contentsPayload = {
  content: Buffer.from('tiers:\n  eligible: [0, 1, 2, 3]\n').toString('base64'),
  encoding: 'base64',
}

export const POLICY_TEXT = 'tiers:\n  eligible: [0, 1, 2, 3]\n'

// An out-of-order issue timeline: who applied `agent-ready` is the newest
// matching labeled event, not the first one in the array.
export const timelinePayload = [
  {
    event: 'labeled',
    actor: { login: 'maintainer' },
    label: { name: 'agent-ready' },
    created_at: '2026-10-11T08:00:00Z',
  },
  { event: 'commented', actor: { login: 'passerby' }, created_at: '2026-10-11T08:30:00Z' },
  {
    event: 'labeled',
    actor: { login: 'owner' },
    label: { name: 'agent-ready' },
    created_at: '2026-10-11T09:00:00Z',
  },
]
