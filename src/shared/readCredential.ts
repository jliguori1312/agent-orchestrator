// Reads one secret from the process's systemd credentials directory
// (ADR-0004). The unit loads each secret with LoadCredential=, so the value
// never enters the process environment; systemd materializes it under
// $CREDENTIALS_DIRECTORY and the code reads $CREDENTIALS_DIRECTORY/<name>.
// This seam is shared across components: C2 reads app-key, the tick entrypoint
// reads "<provider>-key" for C5, and the verify path reads cloudflare-token.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CredentialError } from './credentialError.js'

// A credential name is a filename segment, never a path: the pattern refuses
// slashes, dots, whitespace, and anything that could address a file outside
// the credentials directory. The three names the host loads all match.
const CREDENTIAL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

export interface ReadCredentialOptions {
  // Defaults to $CREDENTIALS_DIRECTORY; explicit in tests.
  readonly credentialsDirectory?: string
}

export function readCredential(name: string, options: ReadCredentialOptions = {}): string {
  // Validate the name before touching the filesystem: a hostile name must not
  // be able to escape the credentials directory even momentarily.
  if (!CREDENTIAL_NAME_PATTERN.test(name)) {
    throw new CredentialError(
      `Refusing to read credential "${name}": a credential name must match ${CREDENTIAL_NAME_PATTERN}`,
    )
  }

  const credentialsDirectory = options.credentialsDirectory ?? process.env.CREDENTIALS_DIRECTORY
  if (credentialsDirectory === undefined || credentialsDirectory === '') {
    throw new CredentialError(
      'Cannot read credentials: $CREDENTIALS_DIRECTORY is not set (systemd LoadCredential= provides it on the host)',
    )
  }

  const credentialPath = join(credentialsDirectory, name)
  try {
    // Verbatim, no trim: a PEM key ends in a newline and callers own their
    // parsing. Transforming the bytes here would be a silent surprise.
    return readFileSync(credentialPath, 'utf8')
  } catch (readFailure) {
    throw new CredentialError(
      `Cannot read credential "${name}" at ${credentialPath}: ${describeFailure(readFailure)}`,
    )
  }
}

// catch variables are unknown-typed under useUnknownInCatchVariables; this
// keeps the failure site readable instead of repeating the narrowing.
function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}
