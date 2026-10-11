# Configuration reference

The orchestrator reads two kinds of config, split by ownership:

- **Host config** — `orchestrator.toml` (this repo's runtime, gitignored). Holds
  where to run, which repos to target, which models to use, and where the
  workspace lives.
- **Target-repo policy** — `.github/agent.yml` inside each target repo. Holds
  that repo's tier eligibility, diff budget, protected-path globs, and review
  settings. It lives with the repo it governs, not here.

Secrets (the GitHub App private key, model-provider keys) come from the
environment, never from `orchestrator.toml`.

## `orchestrator.toml` (host, gitignored)

See [`orchestrator.example.toml`](../orchestrator.example.toml) for a copy-paste
template.

```toml
[target]
repo = "owner/repo"     # first target repository
base = "main"           # branch worktrees freeze from

[workspace]
root = "/var/lib/agent-orchestrator"   # repos cloned + worktrees created here

[model]
provider = "anthropic"  # or a local provider (e.g. ollama)
implement = "claude-..." # model for triage/plan/implement roles
review = "..."           # different model for adversarial review (D5)

[verify]
command = "./scripts/agent/verify.sh"  # run inside each target worktree

[guardrails]
protected_paths = "scripts/agent/protected-paths.txt"  # path inside the target repo
diff_budget_lines = 300
diff_budget_files = 10

[notify]
# No separate channel. `needs-human` rides the GitHub App's @mentions
# through GitHub's native mobile/email delivery (ADR-0003).
```

## `.env` (host, gitignored)

See [`.env.example`](../.env.example). Variables:

| Variable | Purpose |
|---|---|
| `GH_APP_ID` | GitHub App numeric ID |
| `GH_APP_PRIVATE_KEY_PATH` | Path to the App's private key (LXC only, never committed) |
| `GH_APP_INSTALLATION_ID` | Installation ID for the target account/repo |
| `MODEL_PROVIDER` | Model provider identifier |
| `IMPLEMENT_MODEL` | Model for triage/plan/implement roles |
| `REVIEW_MODEL` | Model for the adversarial review role (different from implement) |
| `WORKSPACE_ROOT` | Where target repos are cloned and worktrees created |
| `VERIFY_COMMAND` | Command run inside each target worktree |

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
(terminal). Every run-scoped comment carries `<!-- agent:run=<run_id> -->`.
