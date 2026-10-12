// The `pi`-driven agent driver (C5). A session is one role's system prompt plus
// a user prompt, run once through `pi --print` in a known working directory,
// with the provider key passed per-invocation (ADR-0004). `--session-id` names
// the session after the run id, so re-running with the same session directory
// and id resumes it; the persisted JSONL is located afterward because SEC7
// requires the session transcript to be retained.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Role } from '../../prompts/role.js'
import { AgentDriverError } from './agentDriverError.js'
import { assertPiSucceeded, runPi, type ExecFileFn, type PiSpawn } from './piRunner.js'

export interface AgentModel {
  readonly provider: string
  readonly model: string
}

export interface AgentSessionSpec {
  readonly sessionDir: string
  readonly sessionId: string
  readonly role: Role
  readonly model: AgentModel
  readonly apiKey: string
  readonly prompt: string
  readonly cwd?: string
}

export interface AgentSessionResult {
  readonly output: string
  readonly sessionFile: string
}

export interface AgentSessionOptions {
  readonly spawn?: PiSpawn
  readonly execImpl?: ExecFileFn
}

// A pure argv builder: the whole invocation is asserted in tests without
// spawning anything, and the ordering is stable so a re-tick produces the same
// command. `--provider` and `--api-key` both require `--model`, which is always
// present.
export function buildPiArgs(spec: AgentSessionSpec): string[] {
  return [
    '--print',
    '--session-dir',
    spec.sessionDir,
    '--session-id',
    spec.sessionId,
    '--system-prompt',
    spec.role.systemPrompt,
    '--tools',
    spec.role.tools.join(','),
    '--provider',
    spec.model.provider,
    '--model',
    spec.model.model,
    '--api-key',
    spec.apiKey,
    // SEC6: `--` stops option parsing, so a prompt that begins with `-` (an
    // issue title, say) stays a prompt and cannot inject a pi flag.
    '--',
    spec.prompt,
  ]
}

export async function runAgentSession(
  spec: AgentSessionSpec,
  options: AgentSessionOptions = {},
): Promise<AgentSessionResult> {
  const result = await runPi({
    args: buildPiArgs(spec),
    cwd: spec.cwd,
    spawn: options.spawn,
    execImpl: options.execImpl,
  })
  assertPiSucceeded(result)

  // SEC7: a successful run must have left a transcript. Losing it silently
  // would break the audit trail, so this is a hard failure, not a warning.
  const sessionFile = findSessionFile(spec.sessionDir, spec.sessionId)
  if (sessionFile === null) {
    throw new AgentDriverError(
      `pi completed session ${spec.sessionId} but left no session JSONL under ${spec.sessionDir} (SEC7)`,
    )
  }

  return { output: result.stdout, sessionFile }
}

// pi names the persisted session `<session-dir>/--<cwd>--/<timestamp>_<id>.jsonl`,
// with a timestamp we cannot know ahead of the run. Matching the id suffix
// avoids reimplementing pi's cwd-directory transform, which is not our
// contract; the session id is unique per run, so the match is unambiguous.
export function findSessionFile(sessionDir: string, sessionId: string): string | null {
  if (!existsSync(sessionDir)) return null

  const suffix = `_${sessionId}.jsonl`
  const entries = readdirSync(sessionDir, { recursive: true, encoding: 'utf8' })
  const match = entries.find((entry) => entry.endsWith(suffix))
  return match === undefined ? null : join(sessionDir, match)
}
