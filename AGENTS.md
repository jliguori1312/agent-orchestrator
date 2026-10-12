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
[issue #1](https://github.com/jliguori1312/agent-orchestrator/issues/1),
which carries a dated status snapshot.

- **M0 done (human-only):** LXC provisioned, GitHub App created and installed
  on the first target repo, branch protection set. An agent cannot redo these.
- **M1 in progress** (read-only triage + plan gate), sliced into PRs:
  - [x] PR 1 (#12): toolchain (TypeScript 6, ESLint 10, Vitest 5, CI build
    job) + C1 config loader (`src/components/config/`, strict zod schemas)
  - [x] PR 2 (#13): C14 journal + run identity (`src/components/journal/`,
    ADR-0005) + shared zod primitives (`src/shared/`)
  - [x] PR 3 (#15): C2 part 1 — `readCredential` (`src/shared/`,
    `$CREDENTIALS_DIRECTORY`) + GitHub App JWT mint + installation-token
    exchange (`src/components/github/`, ADR-0003)
  - [x] PR 4 (#16): C2 part 2 — `gh`-driven issue/label/comment ops + SEC2
    collaborator check (`src/components/github/`) + C3 run registry — label
    state machine and `<!-- agent:run=<run_id> -->` markers
    (`src/components/registry/`)
  - [x] PR 5 (#17): C5 agent driver (`pi --print` adapter,
    `src/components/agent/`) + C6 role prompts (`src/prompts/`)
  - [x] PR 6 (#19): C7 tier classifier (`src/components/tier/`) + C15 notifier
    (`src/components/notifier/`)
  - [ ] PR 7: tick entrypoint — triage session → plan comment → label
- **Working rhythm:** TDD per slice (tests drafted and reviewed first, then
  implemented to green); gates must be green on every PR
  (`pnpm typecheck && pnpm lint && pnpm test`).
- **Open decisions:** D7 (separate agent session user, due before M2). D5
  (models) is resolved: one key-based provider at a time with a model per role
  ([config reference](docs/config-reference.md)).

## Layout

| Path | Purpose |
|---|---|
| `src/components/` | C1–C16 components; C1 config loader (`config/`), C14 journal (`journal/`), C2 App auth + `gh` adapter (`github/`), C3 run registry (`registry/`), C5 agent driver (`agent/`), C7 tier classifier (`tier/`), and C15 notifier (`notifier/`) exist so far |
| `src/shared/` | Cross-component primitives: zod strict-object/field constraints + the systemd credential reader (`readCredential`) |
| `src/prompts/` | C6 role system prompts + S4 tool allowlists (`triage`, `plan`, `implement`, `review`) |
| `test/` | Unit tests with mocked `gh` / `pi` / `git` / filesystem |
| `docs/` | Build plan, framework, config reference, ADRs |
| `deploy/systemd/` | Host systemd unit + timer templates (ADR-0004) |
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

## Commands

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
- [ADR log](docs/adr/) — thin orchestrator (0001), runtime decisions (0002),
  GitHub App identity (0003), hardened system unit (0004), run identity +
  journal format (0005).
- First target repo policy:
  [pottery-studio-system #518](https://github.com/jliguori1312/pottery-studio-system/issues/518).
