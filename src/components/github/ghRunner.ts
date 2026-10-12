// The low-level `gh` boundary (C2, part 2). Everything the GitHub adapter does
// goes through here, so the two credential properties that matter live in one
// place: the installation token is passed per-invocation as GH_TOKEN (never an
// ambient user token), and a non-zero exit is turned into a typed GitHubError
// carrying the HTTP status so the client can refresh an expired token.
import { execFile } from 'node:child_process'
import type { ZodError, ZodType } from 'zod'
import { GitHubError } from './githubError.js'

export interface GhResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

// The spawn seam. Tests inject a scripted stand-in so no test shells out, and
// the real implementation is the only place `gh` is exec'd.
export type GhSpawn = (args: readonly string[], token: string) => Promise<GhResult>

// A minimal view of Node's execFile failure, so tests can fake one without
// constructing a full ExecFileException.
export interface ExecFileFailure {
  readonly code?: number | string
  readonly message: string
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv },
  callback: (failure: ExecFileFailure | null, stdout: string, stderr: string) => void,
) => void

export interface RunGhInput {
  readonly args: readonly string[]
  readonly token: string
  readonly spawn?: GhSpawn
  readonly execImpl?: ExecFileFn
}

export async function runGh(input: RunGhInput): Promise<GhResult> {
  if (input.spawn !== undefined) return input.spawn(input.args, input.token)
  return spawnGh(input.args, input.token, input.execImpl ?? defaultExecFile)
}

function spawnGh(args: readonly string[], token: string, execImpl: ExecFileFn): Promise<GhResult> {
  return new Promise((resolve, reject) => {
    const onExit = (failure: ExecFileFailure | null, stdout: string, stderr: string): void => {
      if (failure === null) {
        resolve({ exitCode: 0, stdout, stderr })
        return
      }

      // A non-numeric code means gh could not be run at all (e.g. ENOENT),
      // which is distinct from gh running and reporting a failure.
      if (typeof failure.code !== 'number') {
        reject(new GitHubError(`Cannot invoke gh: ${failure.message}`))
        return
      }

      resolve({ exitCode: failure.code, stdout, stderr })
    }

    execImpl('gh', args, { env: { ...process.env, GH_TOKEN: token } }, onExit)
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

export interface GhJsonInput<T> {
  readonly args: readonly string[]
  readonly token: string
  readonly schema: ZodType<T>
  readonly spawn?: GhSpawn
  readonly execImpl?: ExecFileFn
}

export async function ghJson<T>(input: GhJsonInput<T>): Promise<T> {
  const result = await runGh(input)
  assertGhSucceeded(input.args, result)

  let parsedOutput: unknown
  try {
    parsedOutput = JSON.parse(result.stdout)
  } catch (parseFailure) {
    throw new GitHubError(
      `gh ${input.args.join(' ')} returned non-JSON output: ${describeFailure(parseFailure)}`,
    )
  }

  const validated = input.schema.safeParse(parsedOutput)
  if (!validated.success) {
    throw new GitHubError(
      `gh ${input.args.join(' ')} returned an unexpected payload: ${describeSchemaFindings(validated.error)}`,
    )
  }

  return validated.data
}

export interface GhExecInput {
  readonly args: readonly string[]
  readonly token: string
  readonly spawn?: GhSpawn
  readonly execImpl?: ExecFileFn
}

export async function ghExec(input: GhExecInput): Promise<void> {
  const result = await runGh(input)
  assertGhSucceeded(input.args, result)
}

// Extracts the HTTP status gh prints to stderr (e.g. "HTTP 401: Bad
// credentials"), so callers classify an auth failure without scraping a
// human-readable message.
export function httpStatusFromStderr(stderr: string): number | undefined {
  const statusText = /HTTP (\d{3})/.exec(stderr)?.[1]
  return statusText === undefined ? undefined : Number(statusText)
}

export function firstLine(text: string): string {
  const [line = ''] = text.trim().split('\n')
  return line
}

function assertGhSucceeded(args: readonly string[], result: GhResult): void {
  if (result.exitCode === 0) return

  throw new GitHubError(
    `gh ${args.join(' ')} failed with exit code ${result.exitCode}: ${firstLine(result.stderr)}`,
    httpStatusFromStderr(result.stderr),
  )
}

function describeSchemaFindings(zodError: ZodError): string {
  return zodError.issues
    .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
    .join('; ')
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
