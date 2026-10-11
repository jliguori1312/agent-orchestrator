# agent-orchestrator

A thin, self-owned orchestrator that turns a labelled GitHub Issue into a
reviewed, **human-merged** PR — driving [Pi](https://github.com/pi-coding-agent/pi)
sessions inside an isolated on-prem host.

It is **glue, not an agent and not a build system**: a GitHub label state
machine, a git-worktree lifecycle, a Pi session supervisor, and a set of
governance gates. It opens a draft PR and stops; a human merges. It never calls
`gh pr merge`.

## How it works

```
GitHub Issue (label: agent-ready, collaborator only)
        │
        ▼
[1] Triage session  ── pi --tools read,grep,find,ls
        │                posts plan + risk comment
        │                label: needs-human-plan-approval
        │  human: /approve-plan
        ▼
[2] Implement session ── isolated git worktree, scoped tools
        │                enforces protected paths + diff budget
        │                runs scripts/agent/verify.sh
        │                opens DRAFT PR with a change dossier (G7)
        ▼
[3] CI gate → [4] adversarial review (different model) → [5] human merge
```

- **State store:** GitHub Issues + labels + a run-marker comment. No database.
- **Scheduler:** a `systemd` timer (~5 min tick, single slot) on an unprivileged
  LXC.
- **Identity:** a dedicated GitHub App (never a PAT or user token), so agent
  commits/PRs carry bot attribution and cannot inherit a ruleset bypass.
- **Verification:** each target repo's `scripts/agent/verify.sh` is the single
  source of truth for "green".

## Governance model

The orchestrator enforces a repo-agnostic pipeline framework — autonomy tiers
0–9, review gates G1–G7, scope limits S1–S5, security, ownership, process, and
kill criteria. See [docs/agent-assisted-development-pipeline.md](docs/agent-assisted-development-pipeline.md).

Each **target repository** instantiates that framework with its own policy,
stored in its own tree: `.github/agent.yml`, `scripts/agent/protected-paths.txt`,
and `scripts/agent/verify.sh`. The first target repo is
[pottery-studio-system](https://github.com/jliguori1312/pottery-studio-system)
(policy in [issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518)).

## Status

Milestones are mapped in [the build plan](docs/agent-orchestrator-plan.md):

- **M0 — Substrate + host:** LXC provisioned, GitHub App created. *(in progress)*
- **M1 — Read-only triage + plan gate:** config loader, GitHub adapter, run
  registry, journal, triage/plan prompts.
- **M2 — Plan-gated PRs (Tiers 0–3):** worktree manager, implement session,
  guardrails, verifier, dossier, draft PR, human merge.
- **M3 — Adversarial review + metrics.**

## Prerequisites

- Node.js 24 (`.nvmrc`) + pnpm
- `gh` CLI (≥ 2.94)
- `pi` CLI, plus a model provider (or local Ollama)
- A Linux host with `systemd` (recommended: an unprivileged LXC)

## Quick start

M1 scaffold (code) is in progress. Until then:

```bash
pnpm install      # once the M1 dependencies land
cp .env.example .env
cp orchestrator.example.toml orchestrator.toml
# edit .env and orchestrator.toml
```

The real `orchestrator.toml` and `.env` are gitignored; secrets (the GitHub App
private key, model keys) live only on the host — never in this repo.

## Configuration

- Host config: [orchestrator.example.toml](orchestrator.example.toml) →
  `orchestrator.toml`.
- Environment: [.env.example](.env.example).
- Full reference: [docs/config-reference.md](docs/config-reference.md).

## Security model

- Dedicated GitHub App with least-privilege installation tokens; **no ruleset
  bypass grant** (ADR-0003).
- Isolation via an unprivileged LXC + git worktrees + env scrubbing + an egress
  allowlist (ADR-0002 D1).
- No production/deploy secrets in the orchestrator environment.

## Documentation

- [Build plan](docs/agent-orchestrator-plan.md)
- [Pipeline framework](docs/agent-assisted-development-pipeline.md)
- [Config reference](docs/config-reference.md)
- [ADR log](docs/adr/)

## License

[MIT](LICENSE)
