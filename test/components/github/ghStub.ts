// Shared stand-in for the `gh` process. The runner takes an injected spawn, so
// tests script responses and assert on the exact argv and token instead of
// shelling out. It lives beside the github fixtures rather than in src because
// it exists only for tests.
import type { GhResult, GhSpawn } from '../../../src/components/github/ghRunner.js'

export interface StubCall {
  readonly args: readonly string[]
  readonly token: string
}

// Replays queued responses in order and records every invocation. Running out
// of scripted responses is a test bug, so it throws rather than returning
// undefined and letting the code under test read a confusing failure.
export function createGhStub(responses: readonly GhResult[]): { spawn: GhSpawn; calls: StubCall[] } {
  const calls: StubCall[] = []
  let nextIndex = 0

  const spawn: GhSpawn = (args, token) => {
    calls.push({ args: [...args], token })
    const response = responses[nextIndex]
    nextIndex += 1
    if (response === undefined) {
      throw new Error(`gh stub ran out of responses at call ${nextIndex}: gh ${args.join(' ')}`)
    }
    return Promise.resolve(response)
  }

  return { spawn, calls }
}

export function okResponse(stdout: string): GhResult {
  return { exitCode: 0, stdout, stderr: '' }
}

export function errorResponse(exitCode: number, stderr: string): GhResult {
  return { exitCode, stdout: '', stderr }
}

// gh's stderr for an HTTP failure, e.g. "HTTP 401: Bad credentials".
export function httpErrorResponse(status: number, body: string): GhResult {
  return { exitCode: 1, stdout: '', stderr: `HTTP ${status}: ${body}` }
}
