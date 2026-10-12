// Boundary tests for the low-level `gh` runner (C2, part 2). The credential
// properties under test are the ones that matter: the installation token goes
// in as GH_TOKEN and overrides any ambient token, a non-zero exit is typed
// rather than thrown blindly, and only reads are parsed as JSON.
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GitHubError } from '../../../src/components/github/githubError.js'
import {
  ghExec,
  ghJson,
  httpStatusFromStderr,
  runGh,
  type ExecFileFailure,
  type ExecFileFn,
} from '../../../src/components/github/ghRunner.js'

// A fake for Node's execFile: records the argv and env it was handed, then
// replays a canned (failure, stdout, stderr) triple. This keeps gh off the test
// machine while still exercising the real spawn path.
function createExecFake(script: {
  readonly failure: ExecFileFailure | null
  readonly stdout?: string
  readonly stderr?: string
}) {
  const calls: { file: string; args: readonly string[]; env: NodeJS.ProcessEnv }[] = []
  const execImpl: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args, env: options.env })
    callback(script.failure, script.stdout ?? '', script.stderr ?? '')
  }
  return { execImpl, calls }
}

function exitFailure(code: number | string): ExecFileFailure {
  return { code, message: `gh exited with ${String(code)}` }
}

// The ambient token is restored after each test so no state leaks between them.
const ambientToken = process.env.GH_TOKEN
afterEach(() => {
  if (ambientToken === undefined) delete process.env.GH_TOKEN
  else process.env.GH_TOKEN = ambientToken
})

describe('runGh', () => {
  it('spawns gh with the installation token in GH_TOKEN', async () => {
    const { execImpl, calls } = createExecFake({ failure: null, stdout: '[]' })

    await runGh({ args: ['issue', 'list'], token: 'ghs_installation', execImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('gh')
    expect(calls[0]?.args).toEqual(['issue', 'list'])
    expect(calls[0]?.env.GH_TOKEN).toBe('ghs_installation')
  })

  it('overrides an ambient user token with the installation token', async () => {
    process.env.GH_TOKEN = 'ambient_user_token'
    const { execImpl, calls } = createExecFake({ failure: null, stdout: '[]' })

    await runGh({ args: ['api', 'repos/octo/widgets'], token: 'ghs_installation', execImpl })

    expect(calls[0]?.env.GH_TOKEN).toBe('ghs_installation')
  })

  it('maps a zero exit to a successful result', async () => {
    const { execImpl } = createExecFake({ failure: null, stdout: '{"number":1}', stderr: 'noise' })

    await expect(runGh({ args: ['x'], token: 'token', execImpl })).resolves.toEqual({
      exitCode: 0,
      stdout: '{"number":1}',
      stderr: 'noise',
    })
  })

  it('returns the numeric exit code instead of throwing on a non-zero exit', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure(3), stderr: 'boom' })

    await expect(runGh({ args: ['x'], token: 'token', execImpl })).resolves.toEqual({
      exitCode: 3,
      stdout: '',
      stderr: 'boom',
    })
  })

  it('throws GitHubError when gh itself cannot be spawned', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure('ENOENT') })

    await expect(runGh({ args: ['x'], token: 'token', execImpl })).rejects.toThrow(GitHubError)
  })
})

const numberSchema = z.object({ number: z.number() })

describe('ghJson', () => {
  it('parses and validates stdout, ignoring fields it does not name', async () => {
    const { execImpl } = createExecFake({ failure: null, stdout: '{"number":1,"extra":true}' })

    await expect(
      ghJson({ args: ['x'], token: 'token', schema: numberSchema, execImpl }),
    ).resolves.toEqual({ number: 1 })
  })

  it('throws GitHubError carrying the HTTP status on a non-zero exit', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure(1), stderr: 'HTTP 401: Bad credentials' })

    const failure = await captureGitHubError(() =>
      ghJson({ args: ['x'], token: 'token', schema: numberSchema, execImpl }),
    )

    expect(failure.httpStatus).toBe(401)
    expect(failure.message).toContain('401')
  })

  it('throws GitHubError when stdout is not JSON', async () => {
    const { execImpl } = createExecFake({ failure: null, stdout: 'not json' })

    await expect(
      ghJson({ args: ['x'], token: 'token', schema: numberSchema, execImpl }),
    ).rejects.toThrow(/non-JSON/)
  })

  it('throws GitHubError naming the offending field when the payload is wrong', async () => {
    const { execImpl } = createExecFake({ failure: null, stdout: '{"number":"nope"}' })

    await expect(
      ghJson({ args: ['x'], token: 'token', schema: numberSchema, execImpl }),
    ).rejects.toThrow(/number/)
  })
})

describe('ghExec', () => {
  it('resolves on a zero exit', async () => {
    const { execImpl } = createExecFake({ failure: null })

    await expect(ghExec({ args: ['x'], token: 'token', execImpl })).resolves.toBeUndefined()
  })

  it('throws GitHubError on a non-zero exit', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure(1), stderr: 'HTTP 422: bad' })

    await expect(ghExec({ args: ['x'], token: 'token', execImpl })).rejects.toThrow(GitHubError)
  })
})

describe('httpStatusFromStderr', () => {
  it('extracts the status gh prints', () => {
    expect(httpStatusFromStderr('HTTP 403: Resource not accessible')).toBe(403)
    expect(httpStatusFromStderr('no status here')).toBeUndefined()
  })
})

async function captureGitHubError(action: () => Promise<unknown>): Promise<GitHubError> {
  try {
    await action()
  } catch (failure) {
    if (failure instanceof GitHubError) return failure
    throw failure
  }
  throw new Error('expected the action to reject with GitHubError')
}
