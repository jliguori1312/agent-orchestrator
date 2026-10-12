// Filesystem-boundary tests for readCredential (C2 part 1, ADR-0004): on the
// host the secrets arrive as systemd credentials under $CREDENTIALS_DIRECTORY,
// which LoadCredential= materializes into the service's private directory.
// Tests use a real temp directory like the config/journal suites, because the
// directory is an explicit path — nothing needs injecting.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CredentialError } from '../../src/shared/credentialError.js'
import { readCredential } from '../../src/shared/readCredential.js'

describe('readCredential', () => {
  let credentialsDirectory: string

  beforeEach(() => {
    credentialsDirectory = mkdtempSync(join(tmpdir(), 'orchestrator-credentials-'))
  })

  afterEach(() => {
    rmSync(credentialsDirectory, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  // Mirrors the config/journal capture helpers: run `action`, insist the
  // failure is the component's own error type, and hand it back for message
  // assertions.
  function captureCredentialError(action: () => unknown): CredentialError {
    try {
      action()
      throw new Error('expected the action to throw CredentialError')
    } catch (failure) {
      if (failure instanceof CredentialError) return failure
      throw failure
    }
  }

  it('reads a credential file verbatim, preserving its trailing newline', () => {
    // PEM files end in a newline; readCredential is a byte-faithful read, and
    // trimming here would be a silent transform the caller never asked for.
    const pemText = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n'
    writeFileSync(join(credentialsDirectory, 'app-key'), pemText, 'utf8')

    expect(readCredential('app-key', { credentialsDirectory })).toBe(pemText)
  })

  it('defaults to $CREDENTIALS_DIRECTORY when no directory is passed', () => {
    writeFileSync(join(credentialsDirectory, 'anthropic-key'), 'sk-fake\n', 'utf8')
    vi.stubEnv('CREDENTIALS_DIRECTORY', credentialsDirectory)

    expect(readCredential('anthropic-key')).toBe('sk-fake\n')
  })

  it('throws CredentialError naming the environment variable when it is unset', () => {
    vi.stubEnv('CREDENTIALS_DIRECTORY', '')

    const failure = captureCredentialError(() => readCredential('app-key'))
    expect(failure.message).toContain('CREDENTIALS_DIRECTORY')
  })

  it('throws CredentialError naming the credential and path when the file is missing', () => {
    const failure = captureCredentialError(() =>
      readCredential('cloudflare-token', { credentialsDirectory }),
    )

    expect(failure.message).toContain('cloudflare-token')
    expect(failure.message).toContain(join(credentialsDirectory, 'cloudflare-token'))
  })

  it('accepts the three credentials the host actually loads', () => {
    for (const name of ['app-key', 'anthropic-key', 'cloudflare-token']) {
      writeFileSync(join(credentialsDirectory, name), 'value\n', 'utf8')

      expect(readCredential(name, { credentialsDirectory })).toBe('value\n')
    }
  })

  it('rejects names that could escape the credentials directory', () => {
    // A name is a filename segment, never a path: nothing a caller passes may
    // address a file outside $CREDENTIALS_DIRECTORY, even by accident.
    for (const hostile of ['../app-key', 'app/key', '-app', 'App-Key', '', 'app.key']) {
      expect(() => readCredential(hostile, { credentialsDirectory }), hostile).toThrow(
        CredentialError,
      )
    }
  })
})
