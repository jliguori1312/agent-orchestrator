// The single error type for journal write refusals and read integrity
// failures (ADR-0005 §5/§6). Unlike the config loader's ConfigError there are
// no structured issues: a journal failure means "stop and look at the file",
// so the aggregated per-line details live directly in the message.
export class JournalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalError'
  }
}
