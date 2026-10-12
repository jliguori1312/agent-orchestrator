// The single error type for every way config loading can fail: unreadable
// file, unparsable text, or schema violations. The issues array is empty for
// the first two and carries one entry per schema finding otherwise, so a
// human fixing a hand-edited file sees every problem at once instead of one
// complaint per orchestrator tick.
import type { ZodError } from 'zod'

export interface ConfigIssue {
  readonly path: string
  readonly message: string
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[]

  constructor(message: string, issues: readonly ConfigIssue[] = []) {
    super(message)
    this.name = 'ConfigError'
    this.issues = issues
  }
}

// Zod issue paths are PropertyKey[]; flatten them to dot notation so a report
// reads like the config file's own structure (workspace.root,
// tiers.eligible.0) and can be acted on without opening the schema.
export function toConfigIssues(zodError: ZodError): ConfigIssue[] {
  return zodError.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

// One line per finding under a header naming the file — rendered verbatim in
// the systemd journal, so no fancy formatting.
export function formatConfigIssues(header: string, issues: readonly ConfigIssue[]): string {
  const findings = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n')
  return `${header}\n${findings}`
}
