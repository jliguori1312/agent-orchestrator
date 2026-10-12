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
└─ unprivileged LXC (systemd)  [ADR-0002 D1, ADR-0004]
   └─ agent-orchestrator (own repo [ADR-0002 D6]; Node 24, systemd timer, ~5 min tick)
      ├─ gh CLI          → Issues / labels / PRs / CI status / branch protection
      │                    driven by GitHub App installation tokens [ADR-0003]
      ├─ git worktrees   → workspace_root/.worktrees/agent-<issue>-<run_id>
      │                    (target repos cloned under workspace_root)
      └─ pi --print …    → triage / plan / implement / review sessions
                           (session JSONL retained under <worktree>/.pi-session/)

Egress: restricted — public internet only (TCP 80/443 + DNS to the local
        resolver); inbound DROP; RFC1918, link-local/metadata (169.254.0.0/16),
        multicast, and the Proxmox host/gateway blocked. Web search, arbitrary
        docs, and other repos stay reachable — see "Egress policy" below.
Identity: dedicated GitHub App [ADR-0003] — least-privilege installation
          tokens, no ruleset bypass, bot attribution on every write.
          No PAT, no user-account token (it would inherit the owner's
          repo-admin ruleset bypass).
Pi creds: per-deployment agent dir, isolated from any other deployment.
```

### Egress policy

The agent reads public sources (web search, docs, upstream repos) during
triage/plan/implement/review, so a hostname allowlist is not workable — the
research surface is unbounded. The property we need is not "block the
internet" but "block *inward* reach": the agent may read the public web but
must not touch the host, LAN, or private/metadata endpoints. Egress is
therefore restricted by direction and destination class:

| Direction | Policy |
|---|---|
| Inbound | DROP all (nothing needs to reach the agent) |
| Outbound | ACCEPT public internet on TCP 80/443; ACCEPT DNS to the configured resolver |
| Outbound | DROP RFC1918 (`10/8`, `172.16/12`, `192.168/16`), loopback, link-local (`169.254/16`, incl. cloud metadata), multicast, and the Proxmox host/gateway |
| Everything else | DROP |

Accepted residual risk: with public 443 open, a compromised prompt could
exfiltrate the App private key over HTTPS. This is bounded by SEC3 (no
production/deploy secrets in the container), ADR-0003 (least-privilege App, no
merge/admin/ruleset bypass), G3/G5 (human review before merge), and the LXC's
single-purpose disposability. Closing it fully would require an egress proxy
choke point (`HTTPS_PROXY`) with outbound DLP — deferred as hardening.

## 4. Decisions already made

| Decision | Choice | Rationale |
|---|---|---|
| Language/runtime | TypeScript on Node 24 (pnpm workspace) | Repo is TS; Pi is TS; matches `.nvmrc` |
| Agent interface | Pi **CLI** (`--print --session-dir --tools --system-prompt`), behind an adapter | Most stable Pi contract; Orbi proved it works; SDK/RPC can swap in later |
| GitHub interface | `gh` CLI driven by GitHub App installation tokens | Least privilege, no ruleset bypass, bot attribution (ADR-0003) |
| Repo placement | Separate `agent-orchestrator` repo; target-repo policy stays in each target repo | Not tied to any target repo; reusable later without extra work (ADR-0002 D6) |
| Isolation | Dedicated LXC/VM + git worktree + env scrubbing + public-internet-only egress (private/link-local/host blocked) | SEC4; the host is the boundary |
| Scheduling | Hardened systemd **system** unit + timer (~5 min tick), single slot | Simple, restart-resilient; no daemon state; unit not writable by the agent's user (ADR-0004) |
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

- **Host** (`orchestrator.jsonc`): repo, base branch, workspace root, a single
  key-based Pi provider with a model per role (review may differ from
  implement), verify command, slot count, notification channel, egress policy
  (public-only; §3), protected-paths path.
- **Repo** (`.github/agent.yml`): tier eligibility, diff budget, protected
  globs, plan-gate on/off, review model, labels.

## 8. Milestones

Mapped onto the framework phases. Each milestone is shippable and ends at a human
decision.

### M0 — Substrate + host (Phase 0 closure)

- Confirm CI, `verify.sh`, `protected-paths.txt`, branch protection, previews.
- Provision the unprivileged LXC (ADR-0002 D1); install Node 24, pnpm, `gh`,
  Pi; restrict egress to the public internet (§3 "Egress policy"). Install the
  system-unit templates from `deploy/systemd/`
  ([ADR-0004](./adr/0004-run-orchestrator-as-hardened-system-unit.md)).
- Create the GitHub App and install it on the first target repo only
  (ADR-0003); store its private key in the LXC
  (`/etc/agent-orchestrator/app.pem`). Defer the full secret mechanism (systemd
  `LoadCredential=` files for the model key and read-only Cloudflare token) to
  M1, when C1/C2/C5 define what the code reads.
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
- **D2 — Scheduler:** systemd timer, ~5 min tick, single slot (ADR-0002;
  system-unit detail in [ADR-0004](./adr/0004-run-orchestrator-as-hardened-system-unit.md)).
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

- **D5 — Models:** resolved by the single-provider simplification. One
  key-based provider at a time, with an explicit model per role; the review
  role uses a different model on that same provider (correlated blind spots
  are reduced by model, not provider).
- **D7 — Agent session user:** run the Pi agent session as a separate,
  lower-privilege user than the secret-holding orchestrator process (both are
  currently `agent-orchestrator`, so the agent's `bash` could read the App key
  via `$CREDENTIALS_DIRECTORY`). Decide before M2, when the implement session
  gains `bash`.

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Orchestration bugs (new code) | Unit tests with mocked `gh`/`pi`/`git`; small components; Orbi's tests as a bug catalog |
| `bash` bypasses protected paths | Orchestrator diff check + optional Pi tool-layer hook; dedicated LXC/VM boundary |
| Credential exposure | Dedicated GitHub App (least privilege, no ruleset bypass — ADR-0003); per-deployment Pi agent dir; env scrubbing; no deploy secrets |
| Sandbox escape / egress | Unprivileged LXC or VM; public-internet-only egress (private/link-local/host blocked); no host mounts |
| Scope creep | §2 non-goals; milestones gated by human exits |

## 11. Follow-ups

- [x] Point the first target repo's `AGENTS.md` and policy doc at this repo
  and its ADRs.
- [x] Decide D1–D4/D6 before M0 provisioning (ADR-0002); D3/D5 before M1/M3
  (D3 resolved in ADR-0002; D5 still open, due before M3).
- [x] Provision the LXC and create the GitHub App (M0).
- Scaffold this repository (M1) — in progress, sliced into PRs
  (toolchain landed with PR 1):
  - [x] PR 1 (#12): toolchain + C1 config loader
  - [x] PR 2 (#13): C14 journal + run identity ([ADR-0005](./adr/0005-run-identity-and-journal-format.md))
  - [x] PR 3 (#15): C2 part 1 — `readCredential` + App JWT mint/installation-token exchange
  - [x] PR 4 (#16): C2 part 2 (issues/labels/comments via `gh` + SEC2
    collaborator check) + C3 run registry (label state machine + run-marker
    comments)
  - [x] PR 5 (#17): C5 agent driver + C6 role prompts
  - [x] PR 6 (#19): C7 tier classifier (`src/components/tier/`) + C15 notifier
    (`src/components/notifier/`)
  - [x] PR 7 (#20): tick entrypoint (triage → plan comment → label)
