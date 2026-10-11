# ADR-0001: Build a thin agent orchestrator on Pi (reject the Orbi dependency)

> **Migrated** from `pottery-studio-system` `docs/adr/0003-build-thin-orchestrator-on-pi.md`
> on 2026-10-10 and renumbered ADR-0001 here. The superseded "adopt Orbi"
> decision (pottery ADR-0002) is not carried as a standalone record; its
> evidence is folded into the Evidence section below.

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Repository owner
- **Supersedes:** the earlier decision to adopt Orbi as the delivery engine
- **Extends:** the agent-assisted development pipeline adopted by the first
  target repo ([pottery-studio-system ADR-0001](https://github.com/jliguori1312/pottery-studio-system/blob/main/docs/adr/0001-adopt-agent-assisted-pipeline.md));
  pipeline principles, autonomy tiers, and non-goals stay in force
- **See also:** [pottery-studio-system issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518)
  (first target repo's policy), [the orchestrator build plan](../agent-orchestrator-plan.md)

## Context

An earlier decision adopted [Orbi](https://github.com/orbi-build/orbi) as the delivery
engine after research found it implements the #518 loop on Pi. Before
building a deployment around it, we ran due diligence on Orbi's maturity and
community health. That diligence changed the conclusion.

The #518 non-goals — no autonomous merge, human-owned core, protected paths,
credential isolation — are exactly the properties we need. Orbi either lacks
them or has open, unresolved defects in them:

- **#1359** — the human acceptance gate accepts `ai-human-review` from any
  actor and does not bind it to a commit or head. The human gate is bypassable.
- **#1360** — every deployment on a machine shares `~/.pi/agent/auth.json`;
  there is no per-deployment key isolation for the Pi agent directory.
- **#1358** — a second deployment serving the same repository can restart a
  live delivery.
- **#259** — runner runtime state still lives in the worktree, relying on
  `.gitignore` for isolation.
- Orbi's Runner **auto-merges** a reviewed head; it has no human-merge mode.

## Decision

**We will build a thin, self-owned agent orchestrator on Pi instead of
depending on Orbi.** Orbi is demoted to a **read-only reference
implementation** (its design and tests are a good map of the edge cases).
OpenHands is retained as a documented fallback if we decide we do not want to
own orchestration at all. We will **not fork Orbi** — forking a project
shipping ~2 releases/day with a bus factor of one combines its maintenance
burden with our divergence burden while still requiring us to rebuild the
governance we care about.

The orchestrator runs self-hosted on the Proxmox host, drives Pi sessions, uses
`gh` and git worktrees, and **stops at a draft PR for a human to merge**.

## Evidence

Repository health, measured 2026-10-09:

| | Orbi | Pi |
|---|---|---|
| Age | ~6 weeks (created 2026-08-24) | 14 months |
| Stars / forks / watchers | 212 / 24 / **0** | 113,809 / 14,468 / 345 |
| Commits | **2,050 in ~6 weeks** | steady |
| Releases | **91 in ~6 weeks** (~2/day) | steady |
| Human contributors | **~1** (`xqliu`, 1084 commits) + bot identities | **100+** |
| License | AGPL-3.0 / SUL | MIT |
| Backing | commercial cloud (orbi.build) | community |

Orbi's contributor list is dominated by the bot's own run identities
(`Orbi`, `orbi-build[bot]`, `Orbi Reviewer`, `Review Pi`, `claude`). Zero
watchers means there is no third-party scrutiny. The churn rate (~2 releases
per day) means a pinned version is a snapshot of an unstable product and a
fork would be a treadmill.

## What we reuse, and from where

- **Pi** (MIT, 113k stars, 100+ contributors) — the only agent dependency. We
  drive it through its stable CLI contract
  (`pi --print --session-dir … --tools … --system-prompt …`), with the SDK/RPC
  as a later option behind an adapter.
- **`gh` CLI** — GitHub Issues/labels/PRs/CI/auth.
- **git worktrees** — per-task isolation under a workspace root.
- **systemd timers** — scheduling.
- **Existing Phase 0 artifacts** (in each target repo) — `scripts/agent/verify.sh`,
  `scripts/agent/protected-paths.txt`, CI, branch protection, preview deploys.
- **Orbi, read-only** — study `tests/` (105 files) for edge cases (base-sync,
  review-round budget, 429 recovery, stale worktrees, empty-commit guard
  #1581) without taking the dependency. Do not fork.

## Scope boundaries (out of scope for us)

To keep the build thin, we deliberately do **not** implement what Orbi carries
that we don't need: releases and tagging, milestones, epics, steering,
multi-repo workspaces, `orbi suggest`, launchd, SSE/UI dashboards, or
model-liveness slot probes. The build plan enumerates the components we do
need.

## Consequences

### Positive

- Full control over governance (plan gate, human merge, protected paths, diff
  budget) and credential isolation.
- One trusted dependency (Pi) plus ubiquitous tools (`gh`, git, systemd).
- Intimate knowledge of the system; bugs are ours to fix directly.
- No AGPL/SUL coupling and no commercial upstream whose incentives may diverge.

### Negative / trade-offs

- We own the orchestration bugs, and early versions will be less battle-tested
  than a dedicated product's test suite. Mitigation: Orbi's public tests are a
  bug catalog, and the LXC/VM remains the security boundary regardless.
- More upfront work than adopting a black box.

### Follow-up

- Execute the [orchestrator build plan](../agent-orchestrator-plan.md)
  (milestones M0–M3).
- Provision the dedicated runtime host (unprivileged LXC with systemd +
  linger, or a small VM for a Docker boundary).
- Point each target repo's policy doc and `AGENTS.md` "Agent pipeline" section
  at this ADR and the build plan.
