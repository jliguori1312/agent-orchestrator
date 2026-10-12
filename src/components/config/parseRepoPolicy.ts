// Validates the raw text of a target repo's .github/agent.yml. Fetching that
// text is the GitHub adapter's job (C2, `gh api`); this function owns only
// text → trusted policy, so unit tests never need a boundary mock.
import { parse as parseYaml } from 'yaml'
import { ConfigError, formatConfigIssues, toConfigIssues } from './configError.js'
import { repoPolicySchema, type RepoPolicy } from './repoPolicySchema.js'

export function parseRepoPolicy(policyText: string): RepoPolicy {
  let parsedDocument: unknown
  try {
    parsedDocument = parseYaml(policyText)
  } catch (yamlFailure) {
    const reason = yamlFailure instanceof Error ? yamlFailure.message : String(yamlFailure)
    throw new ConfigError(`Failed to parse repo policy (.github/agent.yml) as YAML: ${reason}`)
  }

  // An empty policy document parses to null; report it as emptiness rather
  // than as a wall of missing-field issues.
  if (parsedDocument === undefined || parsedDocument === null) {
    throw new ConfigError('Repo policy (.github/agent.yml) is empty')
  }

  const result = repoPolicySchema.safeParse(parsedDocument)
  if (!result.success) {
    const issues = toConfigIssues(result.error)
    throw new ConfigError(
      formatConfigIssues('Invalid repo policy (.github/agent.yml)', issues),
      issues,
    )
  }

  return result.data
}
