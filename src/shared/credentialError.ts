// The single error type for every way reading a systemd credential can fail:
// the credentials directory is unset, the name is not a safe filename, or the
// file cannot be read. Unlike ConfigError there are no structured issues — the
// fix is always "look at the credentials directory" — so the actionable
// detail (credential name, full path, reason) lives directly in the message.
export class CredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CredentialError'
  }
}
