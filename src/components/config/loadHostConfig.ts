// Reads, parses, and validates the hand-edited host config. Every failure
// mode throws ConfigError naming the file, so the journal entry from a
// crashed tick is actionable without re-running anything.
import { readFileSync } from 'node:fs'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { ConfigError, formatConfigIssues, toConfigIssues } from './configError.js'
import { hostConfigSchema, type HostConfig } from './hostConfigSchema.js'

export function loadHostConfig(configPath: string): HostConfig {
  let configText: string
  try {
    configText = readFileSync(configPath, 'utf8')
  } catch (readFailure) {
    throw new ConfigError(`Cannot read host config at ${configPath}: ${describeFailure(readFailure)}`)
  }

  // jsonc-parser refuses a UTF-8 BOM, and editors drop one into hand-edited
  // files often enough that they must be tolerated.
  const textWithoutBom = configText.charCodeAt(0) === 0xfeff ? configText.slice(1) : configText

  const parseErrors: ParseError[] = []
  const parsedDocument: unknown = parseJsonc(textWithoutBom, parseErrors, {
    allowTrailingComma: true,
  })
  if (parseErrors.length > 0) {
    // noUncheckedIndexedAccess types parseErrors[0] as possibly undefined;
    // the length check above makes that unreachable, but the guard keeps the
    // failure message honest rather than asserting.
    const firstParseError = parseErrors[0]
    const reason = firstParseError
      ? printParseErrorCode(firstParseError.error)
      : 'unknown syntax error'
    throw new ConfigError(`Failed to parse host config at ${configPath}: ${reason}`)
  }

  // An empty file (or one holding only comments) parses to undefined with
  // zero errors — a distinct failure from a syntax error, and it reads better
  // reported as emptiness than as a wall of missing-field issues.
  if (parsedDocument === undefined || parsedDocument === null) {
    throw new ConfigError(`Host config at ${configPath} is empty`)
  }

  const result = hostConfigSchema.safeParse(parsedDocument)
  if (!result.success) {
    // Aggregate every finding into one throw — an operator fixing a config
    // file must see all of them, not just the first.
    const issues = toConfigIssues(result.error)
    throw new ConfigError(formatConfigIssues(`Invalid host config at ${configPath}`, issues), issues)
  }

  return result.data
}

// catch variables are unknown-typed under useUnknownInCatchVariables; this
// keeps every failure site readable instead of repeating the narrowing.
function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
