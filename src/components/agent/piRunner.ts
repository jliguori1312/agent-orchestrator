// The low-level `pi` boundary (C5). Everything the agent driver does goes
// through here, so the pi-process properties that matter live in one place: the
// provider API key travels as a per-invocation argv flag (--api-key), never an
// ambient environment variable (ADR-0004), the working directory is explicit
// (pi reads project context and groups sessions by it), and a failed run is
// returned as a typed result rather than thrown blindly.
import { execFile } from 'node:child_process'
import { AgentDriverError } from './agentDriverError.js'

export interface PiResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

// Everything the spawned process needs. Carried as one object so the test seam
// observes exactly what the real spawn receives.
export interface PiInvocation {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string | undefined
}

// The spawn seam. Tests inject a scripted stand-in so no test starts a model,
// and the real implementation is the only place `pi` is exec'd.
export type PiSpawn = (invocation: PiInvocation) => Promise<PiResult>

// A minimal view of Node's execFile failure, so tests can fake one without
// constructing a full ExecFileException.
export interface ExecFileFailure {
  readonly code?: number | string
  readonly message: string
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string },
  callback: (failure: ExecFileFailure | null, stdout: string, stderr: string) => void,
) => void

export interface RunPiInput {
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv
  readonly cwd?: string
  readonly spawn?: PiSpawn
  readonly execImpl?: ExecFileFn
}

export async function runPi(input: RunPiInput): Promise<PiResult> {
  const env = { ...process.env, ...(input.env ?? {}) }
  if (input.spawn !== undefined) {
    return input.spawn({ args: input.args, env, cwd: input.cwd })
  }
  return spawnPi(input.args, env, input.cwd, input.execImpl ?? defaultExecFile)
}

function spawnPi(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  execImpl: ExecFileFn,
): Promise<PiResult> {
  return new Promise((resolve, reject) => {
    const onExit = (failure: ExecFileFailure | null, stdout: string, stderr: string): void => {
      if (failure === null) {
        resolve({ exitCode: 0, stdout, stderr })
        return
      }

      // A non-numeric code means pi could not be run at all (e.g. ENOENT),
      // which is distinct from pi running and reporting a failure.
      if (typeof failure.code !== 'number') {
        reject(new AgentDriverError(`Cannot invoke pi: ${failure.message}`))
        return
      }

      resolve({ exitCode: failure.code, stdout, stderr })
    }

    execImpl('pi', args, { env, cwd }, onExit)
  })
}

const defaultExecFile: ExecFileFn = (file, args, options, callback) => {
  execFile(file, [...args], options, (failure, stdout, stderr) => {
    callback(
      failure === null ? null : { code: failure.code, message: failure.message },
      stdout,
      stderr,
    )
  })
}

// A non-zero exit means pi ran and failed (print mode exits non-zero when the
// final response is an error or was aborted). The argv is deliberately not
// echoed: it carries the provider API key (--api-key), and error messages are
// journaled.
export function assertPiSucceeded(result: PiResult): void {
  if (result.exitCode === 0) return

  throw new AgentDriverError(
    `pi failed with exit code ${result.exitCode}: ${firstLine(result.stderr)}`,
    result.exitCode,
  )
}

function firstLine(text: string): string {
  const [line = ''] = text.trim().split('\n')
  return line
}
