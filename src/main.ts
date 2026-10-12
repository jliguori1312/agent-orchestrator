// The process entrypoint (PR 7). Deliberately thin: it wires the real
// boundaries (filesystem config, systemd credentials, `gh`, `pi`) into
// runTick and maps the outcome to an exit code. All orchestration lives in
// runTick, which is unit-tested with fakes; this file only assembles them.
import { existsSync } from 'node:fs'
import { runAgentSession } from './components/agent/agentDriver.js'
import { loadHostConfig } from './components/config/loadHostConfig.js'
import { credentialNameForProvider } from './components/config/modelSelection.js'
import { obtainInstallationToken } from './components/github/githubAppAuth.js'
import { createGitHubClient } from './components/github/githubClient.js'
import { appendJournalRecord, type JournalEventInput } from './components/journal/journal.js'
import { runTick, type TickOutcome } from './components/tick/tick.js'
import { journalDirectory, repoCheckoutDirectory } from './components/tick/tickPaths.js'
import { readCredential } from './shared/readCredential.js'

// The systemd unit's WorkingDirectory is the checkout, so the default relative
// path resolves there; argv/env overrides exist for manual M1 runs.
const configPath = process.argv[2] ?? process.env.ORCHESTRATOR_CONFIG ?? 'orchestrator.jsonc'

try {
  const outcome = await runOnce(configPath)
  console.log(describeOutcome(outcome))
} catch (failure) {
  // A non-zero exit marks the systemd unit failed; the message is the whole
  // actionable report, so it is printed verbatim rather than wrapped.
  console.error(describeFailure(failure))
  process.exitCode = 1
}

async function runOnce(path: string): Promise<TickOutcome> {
  const config = loadHostConfig(path)

  // D-a: the read-only base clone is human-provisioned host substrate (like the
  // LXC/GitHub App in M0). C4 owns the writable worktree lifecycle in M2; M1
  // only needs the clone to exist so the read-only sessions can inspect it.
  const checkout = repoCheckoutDirectory(config)
  if (!existsSync(checkout)) {
    throw new Error(
      `Target repo checkout missing at ${checkout}: clone ${config.target.repo} there during M1 host setup`,
    )
  }

  const privateKey = readCredential('app-key')
  const providerKey = readCredential(credentialNameForProvider(config.model.provider))

  const github = createGitHubClient({
    repo: config.target.repo,
    obtainToken: async () =>
      (
        await obtainInstallationToken({
          privateKey,
          appId: config.github_app.app_id,
          installationId: config.github_app.installation_id,
        })
      ).token,
  })

  const journalRoot = journalDirectory(config.workspace.root)
  const journal = {
    append: (input: JournalEventInput): void => appendJournalRecord(journalRoot, input),
  }

  return runTick({
    github,
    journal,
    config,
    runSession: runAgentSession,
    readProviderKey: () => providerKey,
  })
}

function describeOutcome(outcome: TickOutcome): string {
  switch (outcome.kind) {
    case 'idle':
      return 'tick: no agent-ready issue to process'
    case 'triaged':
      return `tick: issue #${outcome.issueNumber} planned (run ${outcome.runId}); awaiting human plan approval`
    case 'escalated':
      return `tick: issue #${outcome.issueNumber} escalated (${outcome.reason}, run ${outcome.runId})`
  }
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure)
}
