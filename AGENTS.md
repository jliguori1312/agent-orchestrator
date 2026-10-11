# AGENTS.md — agent-orchestrator

Context for agents working on this repository. This repo is the **orchestrator
product**; it is *not* a target repo of itself. Target-repo policy (tiers,
protected paths, verify command) lives in each target repo, not here.

## What this repo is

A TypeScript/Node 24 orchestrator that drives `pi` CLI sessions through the
stages of the agent-assisted development pipeline (triage → plan → implement →
review → draft PR → human merge). The governance it enforces is documented in
[docs/agent-assisted-development-pipeline.md](docs/agent-assisted-development-pipeline.md);
the build plan is [docs/agent-orchestrator-plan.md](docs/agent-orchestrator-plan.md).

## Status & next steps

Migrated out of `pottery-studio-system` on 2026-10-10: the framework, build
plan, and ADRs are canonical here now. The first target repo keeps only its own
policy ([issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518));
a follow-up PR in that repo (`chore/relocate-orchestrator-docs`) removes the
migrated docs. Work is tracked in
[issue #1](https://github.com/jliguori1312/agent-orchestrator/issues/1).

- **Done:** repo scaffolded; framework, build plan, ADRs, and config templates
  committed. No source code yet.
- **Human-only (M0):** provision the unprivileged LXC; create + install the
  GitHub App; set branch protection/rulesets. An agent cannot do these.
- **Agent-doable now (M1):** scaffold components C1–C7, C14, C15 (config
  loader, GitHub adapter with App token mint/refresh, run registry, journal,
  notifier, triage/plan prompts, tier classifier) with mocked-boundary unit
  tests. Can proceed in parallel with M0.
- **Open decision:** D5 (implement vs review model) — due before M3.

## Layout

| Path | Purpose |
|---|---|
| `src/components/` | C1–C16 components (config loader, GitHub adapter, run registry, worktree manager, agent driver, role prompts, tier classifier, plan gate, guardrails, verifier, reviewer, dossier writer, merge handoff, journal, notifier, metrics) |
| `src/prompts/` | Triage, plan, implement, review system prompts |
| `test/` | Unit tests with mocked `gh` / `pi` / `git` / filesystem |
| `docs/` | Build plan, framework, config reference, ADRs |
| `orchestrator.example.jsonc` | Host-config template (copy to gitignored `orchestrator.jsonc`) |

## Boundaries

- The GitHub interface is `gh` CLI driven by GitHub App installation tokens
  (ADR-0003) — never a PAT or user token.
- `pi` is driven through its stable CLI contract
  (`--print --session-dir --tools --system-prompt`), behind an adapter so the
  SDK/RPC can swap in later.
- No auto-merge. The orchestrator opens a draft PR and stops.
- No database; state is GitHub labels + a run-marker comment + an on-disk JSONL
  journal.

## Conventions

- TypeScript, Node 24, pnpm. No semicolons unless syntactically necessary.
- Descriptive variable names; prefer ternaries for simple logic; group code into
  logical blocks separated by blank lines; comment *why*, not *what*.
- Each component is small and independently testable; external boundaries
  (`gh`, `pi`, `git`, filesystem) are mocked in unit tests.
- Config validation uses zod; host config and target-repo policy fail fast with
  clear messages.

## Commands (once M1 dependencies land)

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest
```

## Security

- Never commit the GitHub App private key, `.env`, or the real
  `orchestrator.jsonc`. Templates live in `.env.example` and
  `orchestrator.example.jsonc` with placeholders only.
- A secret scan runs in CI. If you must reference a credential in a test, use a
  clearly-fake placeholder.

## Related

- Build tracker: [issue #1](https://github.com/jliguori1312/agent-orchestrator/issues/1)
- [ADR log](docs/adr/) — build-the-thin-orchestrator (0001), runtime decisions
  (0002), GitHub App identity (0003).
- First target repo policy:
  [pottery-studio-system #518](https://github.com/jliguori1312/pottery-studio-system/issues/518).
