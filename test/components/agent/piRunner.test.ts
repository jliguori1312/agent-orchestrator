// Boundary tests for the low-level `pi` runner (C5). The credential property
// under test is the one that matters: the provider key travels as an argv flag
// (--api-key), never an ambient environment variable (ADR-0004), and a failing
// run is typed rather than thrown blindly. The working directory is explicit
// because pi reads project context and groups sessions by it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDriverError } from '../../../src/components/agent/agentDriverError.js'
import {
  assertPiSucceeded,
  runPi,
  type ExecFileFailure,
  type ExecFileFn,
} from '../../../src/components/agent/piRunner.js'

// A fake for Node's execFile: records the argv, env, and cwd it was handed,
// then replays a canned (failure, stdout, stderr) triple. This keeps pi off
// the test machine while still exercising the real spawn path.
function createExecFake(script: {
  readonly failure: ExecFileFailure | null
  readonly stdout?: string
  readonly stderr?: string
}) {
  const calls: {
    file: string
    args: readonly string[]
    env: NodeJS.ProcessEnv
    cwd: string | undefined
  }[] = []
  const execImpl: ExecFileFn = (file, args, options, callback) => {
    calls.push({ file, args, env: options.env, cwd: options.cwd })
    callback(script.failure, script.stdout ?? '', script.stderr ?? '')
  }
  return { execImpl, calls }
}

function exitFailure(code: number | string): ExecFileFailure {
  return { code, message: `pi exited with ${String(code)}` }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runPi', () => {
  it('spawns pi with the given args and working directory', async () => {
    const { execImpl, calls } = createExecFake({ failure: null, stdout: 'done' })

    await runPi({ args: ['--print', 'hello'], cwd: '/var/lib/trees/issue-42', execImpl })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('pi')
    expect(calls[0]?.args).toEqual(['--print', 'hello'])
    expect(calls[0]?.cwd).toBe('/var/lib/trees/issue-42')
  })

  it('merges the injected environment over the process environment', async () => {
    vi.stubEnv('PI_RUNNER_AMBIENT', 'from-process')
    const { execImpl, calls } = createExecFake({ failure: null })

    await runPi({ args: ['x'], env: { PI_RUNNER_INJECTED: 'from-call' }, execImpl })

    expect(calls[0]?.env.PI_RUNNER_AMBIENT).toBe('from-process')
    expect(calls[0]?.env.PI_RUNNER_INJECTED).toBe('from-call')
  })

  it('hands the invocation to the injected spawn seam', async () => {
    const calls: { args: readonly string[]; cwd: string | undefined }[] = []
    const spawn = (invocation: { args: readonly string[]; cwd?: string }) => {
      calls.push({ args: invocation.args, cwd: invocation.cwd })
      return Promise.resolve({ exitCode: 0, stdout: 'via-seam', stderr: '' })
    }

    const result = await runPi({ args: ['--print', 'x'], cwd: '/tmp/tree', spawn })

    expect(result.stdout).toBe('via-seam')
    expect(calls[0]?.args).toEqual(['--print', 'x'])
    expect(calls[0]?.cwd).toBe('/tmp/tree')
  })

  it('maps a zero exit to a successful result', async () => {
    const { execImpl } = createExecFake({ failure: null, stdout: 'plan text', stderr: 'noise' })

    await expect(runPi({ args: ['x'], execImpl })).resolves.toEqual({
      exitCode: 0,
      stdout: 'plan text',
      stderr: 'noise',
    })
  })

  it('returns the numeric exit code instead of throwing on a non-zero exit', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure(2), stderr: 'model aborted' })

    await expect(runPi({ args: ['x'], execImpl })).resolves.toEqual({
      exitCode: 2,
      stdout: '',
      stderr: 'model aborted',
    })
  })

  it('throws AgentDriverError when pi itself cannot be spawned', async () => {
    const { execImpl } = createExecFake({ failure: exitFailure('ENOENT') })

    await expect(runPi({ args: ['x'], execImpl })).rejects.toThrow(AgentDriverError)
  })
})

describe('assertPiSucceeded', () => {
  it('resolves on a zero exit', () => {
    expect(() => assertPiSucceeded({ exitCode: 0, stdout: '', stderr: '' })).not.toThrow()
  })

  it('throws AgentDriverError carrying the exit code and stderr line', () => {
    const failure = captureAgentDriverError(() =>
      assertPiSucceeded({ exitCode: 1, stdout: '', stderr: 'provider rejected the request\nmore' }),
    )

    expect(failure.exitCode).toBe(1)
    expect(failure.message).toContain('provider rejected the request')
    // Never echo the argv: it carries the provider API key (--api-key).
    expect(failure.message).not.toContain('--api-key')
  })
})

function captureAgentDriverError(action: () => unknown): AgentDriverError {
  try {
    action()
  } catch (failure) {
    if (failure instanceof AgentDriverError) return failure
    throw failure
  }
  throw new Error('expected the action to throw AgentDriverError')
}
