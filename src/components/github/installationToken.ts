// Exchanges the App JWT for a short-lived installation token (ADR-0003). The
// token is what drives `gh` for the rest of the tick. The scheduler is
// single-slot and each tick is a fresh process, so there is nothing to cache
// between runs — "refresh" here means "obtain a fresh token".
import { z } from 'zod'
import { nonBlankString } from '../../shared/schemaPrimitives.js'
import { GitHubError } from './githubError.js'

const DEFAULT_API_URL = 'https://api.github.com'

// Parse only the fields we consume. Deliberately NOT the config schemas'
// strictObjectNamingTypos: GitHub owns this response and may add fields at
// any time, so an unknown key is normal rather than a typo. A plain z.object
// strips what we do not name.
const installationTokenResponseSchema = z.object({
  token: nonBlankString,
  expires_at: z.string().datetime(),
})

export interface InstallationToken {
  readonly token: string
  // ISO-8601 UTC, exactly as GitHub reports it.
  readonly expiresAt: string
}

export interface RequestInstallationTokenInput {
  readonly jwt: string
  readonly installationId: string
  readonly apiUrl?: string
  readonly fetchImpl?: typeof fetch
}

export async function requestInstallationToken(
  input: RequestInstallationTokenInput,
): Promise<InstallationToken> {
  const apiUrl = input.apiUrl ?? DEFAULT_API_URL
  const fetchImpl = input.fetchImpl ?? fetch
  const endpoint = `${apiUrl}/app/installations/${input.installationId}/access_tokens`

  let response: Response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        // A GitHub App JWT uses Bearer, not `token` — this is why the exchange
        // does not ride `gh`'s GH_TOKEN auth path.
        Authorization: `Bearer ${input.jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (networkFailure) {
    throw new GitHubError(`Cannot reach GitHub at ${endpoint}: ${describeFailure(networkFailure)}`)
  }

  if (!response.ok) {
    // Read the body best-effort: GitHub's error message is the useful part,
    // and a body read that fails must not mask the status.
    const bodyText = await response.text().catch(() => '')
    const detail = bodyText === '' ? '' : ` — ${bodyText}`
    throw new GitHubError(
      `GitHub refused the installation token at ${endpoint}: HTTP ${response.status}${detail}`,
    )
  }

  let parsedBody: unknown
  try {
    parsedBody = await response.json()
  } catch (parseFailure) {
    throw new GitHubError(
      `GitHub returned a non-JSON installation-token response at ${endpoint}: ${describeFailure(parseFailure)}`,
    )
  }

  const result = installationTokenResponseSchema.safeParse(parsedBody)
  if (!result.success) {
    const findings = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
      .join('; ')
    throw new GitHubError(`GitHub returned an invalid installation-token response: ${findings}`)
  }

  return { token: result.data.token, expiresAt: result.data.expires_at }
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
