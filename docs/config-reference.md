# Configuration reference

The orchestrator reads config in three places, split by ownership and
sensitivity:

- **Host config** — `orchestrator.jsonc` (this repo's runtime, gitignored).
  Holds the non-secret settings: which repos to target, GitHub App identifiers,
  which models to use, and where the workspace lives.
- **Target-repo policy** — `.github/agent.yml` inside each target repo. Holds
  that repo's tier eligibility, diff budget, protected-path globs, and review
  settings. It lives with the repo it governs, not here.
- **Secrets** — the GitHub App private key, the model-provider key, and the
  read-only Cloudflare token. These never live in `orchestrator.jsonc`; on the
  host they are systemd credentials loaded via `LoadCredential=` (see below).

## `orchestrator.jsonc` (host, gitignored)

See [`orchestrator.example.jsonc`](../orchestrator.example.jsonc) for a copy-paste
template.

```jsonc
{
  "target": {
    "repo": "owner/repo",     // first target repository
    "base": "main"            // branch worktrees freeze from
  },

  "github_app": {
    "app_id": "123456",       // numeric GitHub App ID (public, not secret)
    "installation_id": "789012"  // installation ID for the target repo
  },

  "workspace": {
    "root": "/var/lib/agent-orchestrator"   // repos cloned + worktrees created here;
                                            // journal shards derive at <root>/journal/ (ADR-0005)
  },

  "model": {
    "provider": "anthropic",  // or a local provider (e.g. ollama)
    "implement": "claude-...", // model for triage/plan/implement roles
    "review": "..."            // different model for adversarial review (D5)
  },

  "verify": {
    "command": "./scripts/agent/verify.sh"  // run inside each target worktree
  },

  "guardrails": {
    "protected_paths": "scripts/agent/protected-paths.txt",  // path inside the target repo
    "diff_budget_lines": 300,
    "diff_budget_files": 10
  },

  "notify": {
    // No separate channel. `needs-human` rides the GitHub App's @mentions
    // through GitHub's native mobile/email delivery (ADR-0003).
  }
}
```

## Secrets (host, systemd credentials)

Secrets are **files** under `/etc/agent-orchestrator/`, not environment
variables. The systemd unit loads them with `LoadCredential=` (ADR-0004), so
they never enter the process environment and are not inherited by child shells.
On disk they are `root:root` mode `0600`; systemd reads them as root and
materializes each into the service's private `$CREDENTIALS_DIRECTORY`:

| Credential | Source file | Consumed by |
|---|---|---|
| `app-key` | `/etc/agent-orchestrator/app.pem` | C2 — signs the GitHub App JWT |
| `anthropic-key` | `/etc/agent-orchestrator/anthropic.key` | C5 — the model provider |
| `cloudflare-token` | `/etc/agent-orchestrator/cloudflare.token` | `verify.sh` (read-only; `types:fresh`) |

The code reads them from `$CREDENTIALS_DIRECTORY/<name>` via `readCredential`
(`src/shared/`), which refuses any name that is not a safe filename segment.

[`.env.example`](../.env.example) is a **dev-only** convenience for running the
orchestrator manually (outside systemd) during M1 — it points
`CREDENTIALS_DIRECTORY` at the directory holding those three files. It is not
the host mechanism.

## `.github/agent.yml` (target-repo policy)

Lives in each target repo. Example:

```yaml
tiers:
  eligible: [0, 1, 2, 3]   # tiers the agent may attempt
diff_budget:
  max_lines: 300
  max_files: 10
protected_paths: scripts/agent/protected-paths.txt
plan_gate: true             # G1 always-on for eligible tiers
review_model: "..."         # optional per-repo override
```

## Label state machine

`agent-ready` → `agent-in-progress` → `needs-human-plan-approval` →
(`agent-approved`) → `agent-pr-opened` → `agent-merged` (terminal, by a human),
with side exits `agent-fix-needed`, `needs-human`, and `agent-blocked`
(terminal). Every run-scoped comment carries `<!-- agent:run=<run_id> -->`,
with `run_id` in the time-sortable format of
[ADR-0005](./adr/0005-run-identity-and-journal-format.md).
