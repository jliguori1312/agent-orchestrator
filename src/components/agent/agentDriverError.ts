// C5's failure type: pi could not be spawned, exited non-zero, or completed
// without leaving the session JSONL SEC7 requires. Kept apart from GitHubError
// (a transport failure) and JournalError (audit integrity) so the systemd
// journal names the layer that refused. `exitCode` is set when pi ran and
// reported one, which distinguishes a failed model run from a missing binary
// or a missing session file.
export class AgentDriverError extends Error {
  readonly exitCode: number | undefined

  constructor(message: string, exitCode?: number) {
    super(message)
    this.name = 'AgentDriverError'
    this.exitCode = exitCode
  }
}
