# Agent Orchestrator — Build Plan

> **Migrated** from `pottery-studio-system` `docs/agent-orchestrator-plan.md` on
> 2026-10-10. This repository is now the canonical home of the orchestrator
> product; each target repo keeps its own policy (see
> [the framework](agent-assisted-development-pipeline.md) and each target repo's
> `scripts/agent/` + `.github/agent.yml`).
>
> Decisions: [ADR-0001](./adr/0001-build-thin-orchestrator-on-pi.md) (build a
> thin orchestrator on Pi; reject Orbi as a dependency),
> [ADR-0002](./adr/0002-orchestrator-runtime-decisions.md) (runtime decisions
> D1–D4, D6), and [ADR-0003](./adr/0003-orchestrator-authenticates-as-github-app.md)
> (GitHub App identity + notifications). The pipeline framework (principles,
> tiers, gates) is [docs/agent-assisted-development-pipeline.md](./agent-assisted-development-pipeline.md);
> the first target repo's instantiation is
> [pottery-studio-system issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518).
> Verification entry point (per target repo): `scripts/agent/verify.sh`.

## 1. Purpose

Build the smallest self-owned orchestrator that turns a labelled GitHub Issue
into a reviewed, **human-merged** PR, driving Pi sessions inside an isolated
on-prem host. The orchestrator is glue: a GitHub label state machine, a git
worktree lifecycle, a Pi session supervisor, and the pipeline framework's
governance gates. It
is not a coding agent and not a build system.

## 2. Non-goals

- **No auto-merge.** The orchestrator opens a draft PR and stops; a human
  merges. It never calls `gh pr merge`.
- No releases/tagging, milestones, epics, steering, multi-repo workspaces, or
  an SSE/UI dashboard (all out of scope).
- No cron on GitHub Actions; the runner is our own host.
- No forking Orbi and no dependency on it. Orbi is read-only reference material.
- No hand-editing generated files; no agent writes to protected paths.
- No production/deploy secrets in the orchestrator environment.

## 3. Runtime and topology

```
Proxmox host
└─ unprivileged LXC (systemd + linger)  [ADR-0002 D1]
   └─ agent-orchestrator (own repo [ADR-0002 D6]; Node 24, systemd timer, ~5 min tick)
      ├─ gh CLI          → Issues / labels / PRs / CI status / branch protection
      │                    driven by GitHub App installation tokens [ADR-0003]
      ├─ git worktrees   → workspace_root/.worktrees/agent-<issue>-<run_id>
      │                    (target repos cloned under workspace_root)
      └─ pi --print …    → triage / plan / implement / review sessions
                           (session JSONL retained under <worktree>/.pi-session/)

Egress allowlist: api.github.com, github.com, codeload.github.com,
                  model provider (or local Ollama), package registries.
Identity: dedicated GitHub App [ADR-0003] — least-privilege installation
          tokens, no ruleset bypass, bot attribution on every write.
          No PAT, no user-account token (it would inherit the owner's
          repo-admin ruleset bypass).
Pi creds: per-deployment agent dir, isolated from any other deployment.
```

## 4. Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Language/runtime | TypeScript on Node 24 (pnpm workspace) | Repo is TS; Pi is TS; matches `.nvmrc` |
| Agent interface | Pi **CLI** (`--print --session-dir --tools --system-prompt`), behind an adapter | Most stable Pi contract; Orbi proved it works; SDK/RPC can swap in later |
| GitHub interface | `gh` CLI driven by GitHub App installation tokens | Least privilege, no ruleset bypass, bot attribution (ADR-0003) |
| Repo placement | Separate `agent-orchestrator` repo; target-repo policy stays in each target repo | Not tied to any target repo; reusable later without extra work (ADR-0002 D6) |
| Isolation | Dedicated LXC/VM + git worktree + env scrubbing + egress allowlist | SEC4; the host is the boundary |
| Scheduling | systemd timer (~5 min tick), single slot | Simple, restart-resilient; no daemon state |
| State store | GitHub labels + a run marker comment; JSONL journal on disk | No database (matches the framework and Orbi's best idea) |
| Verification | `scripts/agent/verify.sh` in the worktree | Single source of truth for "green" |
| Merge | Human-only | The framework's non-goal; the deliberate inversion of Orbi |
| Notifications | The GitHub App @mentions the human in the issue/PR thread | Rides GitHub's native mobile/email delivery; no extra channel (ADR-0003) |

## 5. Components

Each component is small and independently testable; boundaries (`gh`, `pi`,
`git`, filesystem) are mocked in unit tests.

| # | Component | Responsibility | Reuse | framework gate |
|---|---|---|---|---|
| C1 | **Config loader** | Load host config + per-repo policy; validate with zod | — | — |
| C2 | **GitHub adapter** | Issues, labels, comments, PRs, CI status, branch protection | `gh` | G2, G3 |
| C3 | **Run registry** | Claim (SQLite-free), `run_id`, idempotent resume | labels + marker comment | P1 |
| C4 | **Worktree manager** | Create/freeze from `origin/<base>`, cleanup, reclaim | git worktrees | S2 |
| C5 | **Agent driver** | Spawn Pi sessions per role; capture JSONL; resume via `--session-id` | Pi CLI | — |
| C6 | **Role prompts** | Triage, plan, implement, review system prompts | — | G1, G4 |
| C7 | **Tier classifier** | Map issue → Tier 0–9; gate which tiers are agent-eligible | — | §2 tiers |
| C8 | **Plan gate** | Post plan comment, label `needs-human-plan-approval`, wait for `/approve-plan` | — | G1 |
| C9 | **Guardrails** | Protected paths (S3), diff budget (S1), one-issue-one-PR (S5), blast radius (S2) | protected-paths.txt | S1–S5 |
| C10 | **Verifier** | Run `verify.sh`; capture command + output + SHA | verify.sh | G2, P4 |
| C11 | **Reviewer** | Independent Pi session on a different model; questions/fixes | Pi CLI | G4, G5 |
| C12 | **Dossier writer** | Assemble G7 dossier into the draft PR body | — | G7 |
| C13 | **Merge handoff** | Open draft PR; stop; detect human merge; cleanup | `gh` | G3 |
| C14 | **Journal / audit** | `run_id` JSONL of every action; retain session JSONL | — | SEC7 |
| C15 | **Notifier** | `needs-human` → GitHub mobile / email / ntfy | — | — |
| C16 | **Metrics** | Capture §8 metrics per PR (review minutes, rework, reverts, diff size, tier, G6) | — | P2 |

## 6. Label state machine

`agent-ready` → `agent-in-progress` → `needs-human-plan-approval` →
(`agent-approved`) → `agent-pr-opened` → `agent-merged` (terminal, by a human)
with side exits `agent-fix-needed`, `needs-human`, and `agent-blocked`
(terminal, human decides). A human applies `agent-ready`; only trusted actors
may. Every run-scoped comment carries `<!-- agent:run=<run_id> -->`.

## 7. Config (host + repo)

- **Host** (`orchestrator.toml`): repo, base branch, workspace root, Pi
  provider/model (and review-model override), verify command, slot count,
  notification channel, egress assumptions, protected-paths path.
- **Repo** (`.github/agent.yml`): tier eligibility, diff budget, protected
  globs, plan-gate on/off, review model, labels.

## 8. Milestones

Mapped onto the framework phases. Each milestone is shippable and ends at a human
decision.

### M0 — Substrate + host (Phase 0 closure)

- Confirm CI, `verify.sh`, `protected-paths.txt`, branch protection, previews.
- Provision the unprivileged LXC (ADR-0002 D1); install Node 24, pnpm, `gh`,
  Pi; lock egress.
- Create the GitHub App and install it on the first target repo only
  (ADR-0003); keep its private key in the LXC.
- Exit: `verify.sh` green inside the host; branch protection requires review.

### M1 — Read-only triage + plan gate (Phase 1)

- Scaffold this `agent-orchestrator` repo (ADR-0002 D6): config
  loader, GitHub adapter (with App installation-token mint/refresh,
  ADR-0003), run registry, journal.
- C1–C7, C14, C15; triage/plan sessions with the read-only tool allowlist
  (`--tools read,grep,find,ls`).
- Posts a plan + risk assessment comment; labels `needs-human-plan-approval`.
- No branch, no worktree write, no PR.
- Exit: label triggers only for collaborators; ≥5 issues triaged and
  human-approved/rejected through the flow; run artifacts retained.

### M2 — Plan-gated PRs, Tiers 0–3 (Phase 2)

- C4, C5, C8–C13, C16; worktree, implement session (`--tools
  read,grep,find,ls,edit,write,bash`), `verify.sh`, guardrails, dossier, draft
  PR, **human merge**.
- Exit: ≥5 merged PRs from Tiers 0–3 with no reverts/incidents; every PR
  satisfies G1–G7 and S1–S5; review minutes trending down.

### M3 — Adversarial review + metrics (Phase 3)

- C11 on a different model; metrics capture; kill-criteria checks (framework §7).
- Exit: metrics stable over 4 weeks; explicit expand/freeze decision recorded.

## 9. Decisions (resolved unless noted)

Resolved 2026-10-10 in [ADR-0002](./adr/0002-orchestrator-runtime-decisions.md)
and [ADR-0003](./adr/0003-orchestrator-authenticates-as-github-app.md):

- **D1 — Isolation host:** unprivileged LXC (ADR-0002).
- **D2 — Scheduler:** systemd timer, ~5 min tick, single slot (ADR-0002).
- **D3 — Plan gate:** always-on for Tiers 0–3; revisit after M2 metrics
  (ADR-0002).
- **D4 — Protected-path enforcement:** orchestrator-side diff check as the
  baseline; the Pi tool-layer hook is deferred defense-in-depth, added only
  if journals show `bash` bypass attempts (ADR-0002).
- **D6 — Repo placement:** a separate `agent-orchestrator` repository;
  target-repo policy stays in each target repo (ADR-0002).
- **GitHub identity + notifications:** dedicated GitHub App, never a PAT or
  user-account token (no ruleset bypass, bot attribution); `needs-human`
  notifications ride the App's @mentions through GitHub's native
  mobile/email delivery (ADR-0003).

Still open:

- **D5 — Models:** implement model vs review model (different provider models
  reduce correlated blind spots). Decide before M3.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Orchestration bugs (new code) | Unit tests with mocked `gh`/`pi`/`git`; small components; Orbi's tests as a bug catalog |
| `bash` bypasses protected paths | Orchestrator diff check + optional Pi tool-layer hook; dedicated LXC/VM boundary |
| Credential exposure | Dedicated GitHub App (least privilege, no ruleset bypass — ADR-0003); per-deployment Pi agent dir; env scrubbing; no deploy secrets |
| Sandbox escape / egress | Unprivileged LXC or VM; network allowlist; no host mounts |
| Scope creep | §2 non-goals; milestones gated by human exits |

## 11. Follow-ups

- [x] Point the first target repo's `AGENTS.md` and policy doc at this repo
  and its ADRs.
- [x] Decide D1–D4/D6 before M0 provisioning (ADR-0002); D3/D5 before M1/M3
  (D3 resolved in ADR-0002; D5 still open, due before M3).
- Provision the LXC and create the GitHub App (M0).
- Scaffold this repository (M1) — in progress.
