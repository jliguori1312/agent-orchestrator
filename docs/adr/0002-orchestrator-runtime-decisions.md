# ADR-0002: Orchestrator runtime decisions (D1–D4, D6)

> **Migrated** from `pottery-studio-system` `docs/adr/0004-orchestrator-runtime-decisions.md`
> on 2026-10-10 and renumbered ADR-0002 here.

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Repository owner
- **Extends:** [ADR-0001](./0001-build-thin-orchestrator-on-pi.md) (build the thin orchestrator)
- **See also:** [pottery-studio-system issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518)
  (first target repo's policy), [the orchestrator build plan](../agent-orchestrator-plan.md) (§9 open decisions)

## Context

ADR-0001 decided to build a thin, self-owned orchestrator on Pi. The build plan
left six decisions open (D1–D6); executing milestone M0 (host provisioning) and
M1 (skeleton) requires them resolved. This record closes five of them. D5
(implement vs review models) stays open until M3 and is decided separately.

## Decision

The orchestrator's runtime configuration, as resolved from the build plan's
open decisions:

- **D1 — Isolation host: unprivileged LXC** on the Proxmox host (systemd +
  linger), not a small VM + Docker. The LXC is the security boundary (SEC4);
  we escalate to a VM only if the threat model tightens.
- **D2 — Scheduler: systemd timer**, ~5 min tick, single slot. Not a
  long-lived service with webhooks — no daemon state, restart-resilient.
- **D3 — Plan gate: always-on** for all agent-eligible tiers (0–3). Every
  run posts a plan and waits for `/approve-plan` before implementation.
  Revisit (possibly tier-dependent) only after M2 metrics exist.
- **D4 — Protected-path enforcement: orchestrator-side diff check** against
  `scripts/agent/protected-paths.txt` as the baseline (S3/SEC8). The
  optional Pi tool-layer hook (`spawnHook`/extension) is deferred as
  defense-in-depth, to be added only if run journals show `bash`-based
  bypass attempts.
- **D6 — Repo placement: a separate repository** (e.g. `agent-orchestrator`),
  not `apps/` or `tools/` inside the monorepo. There is no reason the
  orchestrator should be tied to this repo, and no reason it cannot serve
  other projects. We deliberately do **not** invest in cross-project
  reusability now — but the design must not hinder it later: no
  target-repo specifics hardcoded in orchestrator code, host config
  (`orchestrator.toml`, in the orchestrator repo) carries the target-repo
  list, and each target repo keeps its own policy (`.github/agent.yml`).

## Consequences

### Positive

- M0/M1 can proceed; the build plan's open-decision section collapses to
  only D5.
- LXC + systemd timer keeps the substrate small and matches the repo
  toolchain (Node 24, pnpm, `gh`).
- Always-on plan gate keeps G1 simple and uniform across tiers.
- The separate repo keeps orchestration code out of the target repo's
  Cloudflare build graphs, turbo fan-out, and diff-budget pilot metrics.

### Negative / trade-offs

- A separate repo means separate CI, branch protection, and review
  workflow for the orchestrator's own development (small, one-time).
- The orchestrator-side-only protected-path check (D4) is not defense in
  depth yet; a `bash` workaround is caught at diff time, not prevented.

### Follow-up

- Provision the LXC per build plan M0.
- Scaffold this repository per build plan M1 (done).
- Record the GitHub App identity decision (ADR-0003) alongside this one.
