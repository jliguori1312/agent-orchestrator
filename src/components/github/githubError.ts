// The single error type for every failure in the GitHub adapter (C2): minting
// the App JWT, exchanging it for an installation token, and — from PR 4 on —
// the `gh`-driven issue/label/comment calls. Messages carry the context
// (credential, status, field) needed to act from the systemd journal alone.
export class GitHubError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitHubError'
  }
}
