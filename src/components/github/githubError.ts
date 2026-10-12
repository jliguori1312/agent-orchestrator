// The single error type for every failure in the GitHub adapter (C2): minting
// the App JWT, exchanging it for an installation token, and the `gh`-driven
// issue/label/comment calls. Messages carry the context (credential, status,
// field) needed to act from the systemd journal alone. `httpStatus` is set when
// `gh` reported an HTTP status, so the client can refresh an expired
// installation token (401/403) without string-matching at every call site.
export class GitHubError extends Error {
  readonly httpStatus: number | undefined

  constructor(message: string, httpStatus?: number) {
    super(message)
    this.name = 'GitHubError'
    this.httpStatus = httpStatus
  }
}
