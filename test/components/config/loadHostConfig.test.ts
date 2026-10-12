// Filesystem-level tests for loadHostConfig: read → JSONC parse → schema
// validate. Must tolerate comments/trailing commas (it is hand-edited) and
// fail fast with the file path plus every finding aggregated.
//
// Note: there is deliberately no unreadable-file test — running as root,
// permission bits cannot block reads (CAP_DAC_OVERRIDE), so the failure cannot
// be pinned reliably.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError } from '../../../src/components/config/configError.js'
import { loadHostConfig } from '../../../src/components/config/loadHostConfig.js'
import { validHostConfig, withProperty } from './fixtures.js'

describe('loadHostConfig', () => {
  let tempDirectory: string

  beforeEach(() => {
    tempDirectory = mkdtempSync(join(tmpdir(), 'orchestrator-config-'))
  })

  afterEach(() => {
    rmSync(tempDirectory, { recursive: true })
  })

  function writeConfigFile(text: string): string {
    const configPath = join(tempDirectory, 'orchestrator.jsonc')
    writeFileSync(configPath, text)
    return configPath
  }

  // Calls `run`, expecting it to throw ConfigError, and hands the caught
  // error back for message/issue assertions — avoiding repeated
  // unknown-typed catch variable narrowing in every test.
  function captureConfigError(run: () => void): ConfigError {
    try {
      run()
    } catch (thrown) {
      if (thrown instanceof ConfigError) return thrown
    }

    expect.fail('expected the call to throw ConfigError')
  }

  // Comments and trailing commas: exactly what JSON.parse would refuse, so
  // this pin proves the loader really is JSONC-aware.
  const validJsonc = `{
  // Host config — comments must survive parsing.
  "target": { "repo": "owner/repo", "base": "main" },
  "github_app": { "app_id": "123456", "installation_id": "789012" },
  "workspace": { "root": "/var/lib/agent-orchestrator" },
  "model": {
    "provider": "anthropic",
    "triage": "claude-sonnet-4-5",
    "plan": "claude-sonnet-4-5",
    "implement": "claude-sonnet-4-5",
    "review": "claude-opus-4-6",
  },
  "verify": { "command": "./scripts/agent/verify.sh" },
  "guardrails": {
    "protected_paths": "scripts/agent/protected-paths.txt",
    "diff_budget_lines": 300,
    "diff_budget_files": 10,
  },
}`

  it('parses a valid JSONC file with comments and trailing commas', () => {
    const configPath = writeConfigFile(validJsonc)

    expect(loadHostConfig(configPath)).toEqual(validHostConfig)
  })

  it('parses a file with a UTF-8 BOM (common on hand-edited files)', () => {
    const configPath = join(tempDirectory, 'orchestrator-bom.jsonc')
    writeFileSync(configPath, `\uFEFF${validJsonc}`)

    expect(loadHostConfig(configPath)).toEqual(validHostConfig)
  })

  it('throws ConfigError naming the path when the file is missing', () => {
    const missingPath = join(tempDirectory, 'does-not-exist.jsonc')

    expect(() => loadHostConfig(missingPath)).toThrow(ConfigError)
    expect(captureConfigError(() => loadHostConfig(missingPath)).message).toContain(missingPath)
  })

  it('throws ConfigError naming the path on a JSONC syntax error', () => {
    const configPath = writeConfigFile('{ "target": { "repo": "owner/repo" }') // no closing brace

    expect(() => loadHostConfig(configPath)).toThrow(ConfigError)
    expect(captureConfigError(() => loadHostConfig(configPath)).message).toContain(configPath)
  })

  it('throws ConfigError on an empty file', () => {
    const configPath = writeConfigFile('')

    expect(() => loadHostConfig(configPath)).toThrow(ConfigError)
  })

  it('aggregates every schema finding into one throw, naming each property path', () => {
    // Two independent violations in a single file; the loader must report
    // both, not bail at the first.
    const brokenConfig = withProperty(
      withProperty(validHostConfig, 'workspace.root', 'just/a/relative/path'),
      'guardrails.diff_budget_lines',
      0,
    )
    const configPath = writeConfigFile(JSON.stringify(brokenConfig))

    expect(() => loadHostConfig(configPath)).toThrow(ConfigError)
    const configError = captureConfigError(() => loadHostConfig(configPath))
    expect(configError.message).toContain(configPath)
    const reportedPaths = configError.issues.map((issue) => issue.path)
    expect(reportedPaths).toContain('workspace.root')
    expect(reportedPaths).toContain('guardrails.diff_budget_lines')
    expect(reportedPaths).toHaveLength(2)
  })
})
