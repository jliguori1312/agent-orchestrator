// C3's own failure type: an illegal label transition, a claim against an issue
// that is not `agent-ready`, or a trigger from an untrusted actor (SEC2). Kept
// apart from GitHubError (a transport failure) and JournalError (audit
// integrity) so the systemd journal names the layer that refused.
export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}
