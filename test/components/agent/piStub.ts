// Shared stand-in for the `pi` process (C5). The runner takes an injected
// spawn, so tests script responses and assert on the exact argv, environment,
// and working directory instead of starting a model. It lives beside the agent
// fixtures rather than in src because it exists only for tests.
import type {
  PiInvocation,
  PiResult,
  PiSpawn,
} from '../../../src/components/agent/piRunner.js'

export interface PiStubCall {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string | undefined
}

// Replays queued responses in order and records every invocation. Running out
// of scripted responses is a test bug, so it throws rather than returning
// undefined and letting the code under test read a confusing failure.
export function createPiStub(responses: readonly PiResult[]): {
  spawn: PiSpawn
  calls: PiStubCall[]
} {
  const calls: PiStubCall[] = []
  let nextIndex = 0

  const spawn: PiSpawn = (invocation: PiInvocation) => {
    calls.push({ args: [...invocation.args], env: invocation.env, cwd: invocation.cwd })
    const response = responses[nextIndex]
    nextIndex += 1
    if (response === undefined) {
      throw new Error(`pi stub ran out of responses at call ${nextIndex}`)
    }
    return Promise.resolve(response)
  }

  return { spawn, calls }
}

export function okResponse(stdout: string): PiResult {
  return { exitCode: 0, stdout, stderr: '' }
}

export function errorResponse(exitCode: number, stderr: string): PiResult {
  return { exitCode, stdout: '', stderr }
}
