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
- **Scheduler:** a hardened `systemd` system unit + timer (~5 min tick, single
  slot) on an unprivileged LXC.
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

Milestones are mapped in [the build plan](docs/agent-orchestrator-plan.md) and
tracked in [issue #1](https://github.com/jliguori1312/agent-orchestrator/issues/1):

- **M0 — Substrate + host:** provision the LXC; create + install the GitHub App.
  *(done)*
- **M1 — Read-only triage + plan gate:** config loader, GitHub adapter, run
  registry, journal, triage/plan prompts. *(in progress — C1 config loader, C14
  journal, and the C2 App-auth path (credential read, JWT mint, installation
  token) landed in [#12](https://github.com/jliguori1312/agent-orchestrator/pull/12),
  [#13](https://github.com/jliguori1312/agent-orchestrator/pull/13), and
  [#15](https://github.com/jliguori1312/agent-orchestrator/pull/15); the
  `gh`-driven issue/label/comment operations, run registry, role prompts, and
  the tick remain — see [AGENTS.md](AGENTS.md) for the PR-by-PR slice list)*
- **M2 — Plan-gated PRs (Tiers 0–3):** worktree manager, implement session,
  guardrails, verifier, dossier, draft PR, human merge.
- **M3 — Adversarial review + metrics.**

## Prerequisites

- Node.js 24 (`.nvmrc`) + pnpm
- `gh` CLI (≥ 2.94)
- `pi` CLI, plus a model provider (or local Ollama)
- A Linux host with `systemd` (recommended: an unprivileged LXC)

## Quick start

```bash
pnpm install
cp orchestrator.example.jsonc orchestrator.jsonc
# edit orchestrator.jsonc; secrets are systemd credentials on the host

pnpm typecheck && pnpm lint && pnpm test   # the gates every PR must keep green
```

The real `orchestrator.jsonc` is gitignored; secrets (the GitHub App private
key, model key, read-only Cloudflare token) live only on the host as systemd
`LoadCredential=` files — never in this repo. `.env.example` is a dev-only
convenience.

## Configuration

- Host config: [orchestrator.example.jsonc](orchestrator.example.jsonc) →
  `orchestrator.jsonc`.
- Secrets: systemd `LoadCredential=` on the host — see
  [config reference](docs/config-reference.md).
- Dev-only env: [.env.example](.env.example).
- Full reference: [docs/config-reference.md](docs/config-reference.md).

## Security model

- Dedicated GitHub App with least-privilege installation tokens; **no ruleset
  bypass grant** (ADR-0003).
- Isolation via an unprivileged LXC + git worktrees + env scrubbing +
  public-internet-only egress (private/link-local/host blocked) (ADR-0002 D1).
- No production/deploy secrets in the orchestrator environment.

## Documentation

- [Build tracker (issue #1)](https://github.com/jliguori1312/agent-orchestrator/issues/1)
- [Build plan](docs/agent-orchestrator-plan.md)
- [Pipeline framework](docs/agent-assisted-development-pipeline.md)
- [Config reference](docs/config-reference.md)
- [ADR log](docs/adr/)

## License

[MIT](LICENSE)
