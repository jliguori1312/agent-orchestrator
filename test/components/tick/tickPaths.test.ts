// Tests for the tick's path derivations (PR 7). The layout is a contract: the
// journal must match ADR-0005, both session transcripts must sit under the run
// directory (SEC7), and the read-only checkout path must match where the M1 host
// setup clones the target repo.
import { describe, expect, it } from 'vitest'
import {
  POLICY_FILE_PATH,
  journalDirectory,
  repoCheckoutDirectory,
  repoName,
  sessionDirectory,
} from '../../../src/components/tick/tickPaths.js'
import { hostConfig, RUN_ID } from './fixtures.js'

describe('tickPaths', () => {
  it('derives the journal directory from the workspace root (ADR-0005 §2)', () => {
    expect(journalDirectory('/var/lib/agent-orchestrator')).toBe(
      '/var/lib/agent-orchestrator/journal',
    )
  })

  it('groups both session transcripts under the run directory', () => {
    expect(sessionDirectory('/var/lib/agent-orchestrator', RUN_ID)).toBe(
      `/var/lib/agent-orchestrator/sessions/${RUN_ID}`,
    )
  })

  it('locates the read-only repo checkout by repository name', () => {
    expect(repoCheckoutDirectory(hostConfig())).toBe('/var/lib/agent-orchestrator/repo')
  })

  it('extracts the repository name from owner/name', () => {
    expect(repoName('octo/widgets')).toBe('widgets')
  })

  it('names the policy file every target repo carries', () => {
    expect(POLICY_FILE_PATH).toBe('.github/agent.yml')
  })
})
