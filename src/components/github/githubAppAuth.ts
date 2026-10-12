// The public entry point of the App-auth path: mint the JWT from the private
// key and trade it for an installation token. Kept as a thin composition so
// the two steps stay independently testable and the caller (PR 4's `gh`
// runner, later the tick entrypoint) has a single call to make.
import { mintAppJwt } from './appJwt.js'
import { requestInstallationToken, type InstallationToken } from './installationToken.js'

export interface ObtainInstallationTokenInput {
  // PEM from readCredential('app-key').
  readonly privateKey: string
  readonly appId: string
  readonly installationId: string
  readonly now?: () => Date
  readonly apiUrl?: string
  readonly fetchImpl?: typeof fetch
}

export async function obtainInstallationToken(
  input: ObtainInstallationTokenInput,
): Promise<InstallationToken> {
  const jwt = mintAppJwt({ privateKey: input.privateKey, appId: input.appId, now: input.now })

  return requestInstallationToken({
    jwt,
    installationId: input.installationId,
    apiUrl: input.apiUrl,
    fetchImpl: input.fetchImpl,
  })
}
