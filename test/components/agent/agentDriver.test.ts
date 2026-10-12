// Tests for the `pi`-driven agent driver (C5): the argv it builds, the way it
// runs a role session, the SEC7 session-JSONL capture, and the resume contract
// (`--session-id` names the session, so re-running the same id continues it).
// The spawn is stubbed; the session directory is a real temp dir, matching the
// journal/readCredential suites' "components take explicit paths" approach.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentDriverError } from '../../../src/components/agent/agentDriverError.js'
import {
  buildPiArgs,
  findSessionFile,
  runAgentSession,
  type AgentSessionSpec,
} from '../../../src/components/agent/agentDriver.js'
import { generateRunId } from '../../../src/components/journal/runId.js'
import { implementRole } from '../../../src/prompts/implement.js'
import { triageRole } from '../../../src/prompts/triage.js'
import { createPiStub, errorResponse, okResponse } from './piStub.js'

const SESSION_ID = '261011T090312Z-a3f2'

function spec(overrides: Partial<AgentSessionSpec> = {}): AgentSessionSpec {
  return {
    sessionDir: '/var/lib/orchestrator/sessions',
    sessionId: SESSION_ID,
    role: triageRole,
    model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    apiKey: 'sk-ant-fake-placeholder',
    prompt: 'Please triage issue #42.',
    ...overrides,
  }
}

// Writes the session JSONL exactly as pi would: a cwd-derived folder and a
// `<timestamp>_<session-id>.jsonl` file inside it. The timestamp is arbitrary
// because the driver matches on the id suffix, not the timestamp.
function writeSessionFile(sessionDir: string, cwdFolder: string, sessionId: string): string {
  const nestedDirectory = join(sessionDir, `--${cwdFolder}--`)
  mkdirSync(nestedDirectory, { recursive: true })
  const sessionFile = join(nestedDirectory, `1710000000000_${sessionId}.jsonl`)
  writeFileSync(sessionFile, '{"type":"session","version":3}\n', 'utf8')
  return sessionFile
}

function captureAgentDriverError(action: () => Promise<unknown>): Promise<AgentDriverError> {
  return action().then(
    () => {
      throw new Error('expected the action to reject with AgentDriverError')
    },
    (failure: unknown) => {
      if (failure instanceof AgentDriverError) return failure
      throw failure
    },
  )
}

describe('buildPiArgs', () => {
  it('builds the full pi --print invocation in a stable order', () => {
    expect(buildPiArgs(spec())).toEqual([
      '--print',
      '--session-dir',
      '/var/lib/orchestrator/sessions',
      '--session-id',
      SESSION_ID,
      '--system-prompt',
      triageRole.systemPrompt,
      '--tools',
      'read,grep,find,ls',
      '--provider',
      'anthropic',
      '--model',
      'claude-sonnet-4-5',
      '--api-key',
      'sk-ant-fake-placeholder',
      '--',
      'Please triage issue #42.',
    ])
  })

  it('joins the role tools as a comma-separated allowlist', () => {
    const args = buildPiArgs(spec({ role: implementRole }))

    expect(args[args.indexOf('--tools') + 1]).toBe('read,grep,find,ls,edit,write,bash')
  })

  it('places -- before the prompt so a leading dash stays a prompt (SEC6)', () => {
    const args = buildPiArgs(spec({ prompt: '--system-prompt attacker' }))

    expect(args.at(-2)).toBe('--')
    expect(args.at(-1)).toBe('--system-prompt attacker')
  })

  it('passes the role system prompt verbatim', () => {
    const args = buildPiArgs(spec())

    expect(args[args.indexOf('--system-prompt') + 1]).toBe(triageRole.systemPrompt)
  })

  it('is deterministic for identical specs, so a resume reuses the session id', () => {
    expect(buildPiArgs(spec())).toEqual(buildPiArgs(spec()))
  })
})

describe('runAgentSession', () => {
  let sessionDir: string

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'agent-driver-'))
  })

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true })
  })

  it('resolves to the final output and the located session JSONL', async () => {
    const expectedSessionFile = writeSessionFile(sessionDir, 'var-lib-trees-issue-42', SESSION_ID)
    const { spawn, calls } = createPiStub([okResponse('Here is the plan.')])

    const result = await runAgentSession(spec({ sessionDir }), { spawn })

    expect(result.output).toBe('Here is the plan.')
    expect(result.sessionFile).toBe(expectedSessionFile)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(buildPiArgs(spec({ sessionDir })))
  })

  it('threads the working directory through to the pi process', async () => {
    writeSessionFile(sessionDir, 'var-lib-trees-issue-42', SESSION_ID)
    const { spawn, calls } = createPiStub([okResponse('done')])

    await runAgentSession(spec({ sessionDir, cwd: '/var/lib/trees/issue-42' }), { spawn })

    expect(calls[0]?.cwd).toBe('/var/lib/trees/issue-42')
  })

  it('throws AgentDriverError with the exit code when the run fails', async () => {
    const { spawn } = createPiStub([errorResponse(1, 'provider rejected the request')])

    const failure = await captureAgentDriverError(() =>
      runAgentSession(spec({ sessionDir }), { spawn }),
    )

    expect(failure.exitCode).toBe(1)
    expect(failure.message).toContain('provider rejected the request')
  })

  it('throws AgentDriverError when pi leaves no session JSONL (SEC7)', async () => {
    const { spawn } = createPiStub([okResponse('done')])

    const failure = await captureAgentDriverError(() =>
      runAgentSession(spec({ sessionDir }), { spawn }),
    )

    expect(failure.message).toContain(SESSION_ID)
    expect(failure.message).toContain('SEC7')
  })
})

describe('findSessionFile', () => {
  let sessionDir: string

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'agent-session-'))
  })

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true })
  })

  it('returns the nested session file whose name ends with the session id', () => {
    const expected = writeSessionFile(sessionDir, 'var-lib-trees-issue-42', SESSION_ID)

    expect(findSessionFile(sessionDir, SESSION_ID)).toBe(expected)
  })

  it('returns null when the session directory does not exist', () => {
    expect(findSessionFile(join(sessionDir, 'never-created'), SESSION_ID)).toBeNull()
  })

  it('returns null when no file matches the session id', () => {
    writeSessionFile(sessionDir, 'dir', '261011T100000Z-b1c2')

    expect(findSessionFile(sessionDir, SESSION_ID)).toBeNull()
  })

  it('does not match a different session id that shares a suffix', () => {
    writeSessionFile(sessionDir, 'dir', SESSION_ID)

    expect(findSessionFile(sessionDir, '090312Z-a3f2')).toBeNull()
  })
})

describe('run id as a pi session id', () => {
  it('generates run ids that are valid pi --session-id values', () => {
    // pi accepts letters, numbers, '.', '_', and '-', and requires the id to
    // start and end with a letter or number. The run id is used verbatim as the
    // session id, so a format change here would break every session.
    const sessionId = generateRunId(() => new Date('2026-10-11T09:03:12.000Z'))

    expect(sessionId).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/)
  })
})
