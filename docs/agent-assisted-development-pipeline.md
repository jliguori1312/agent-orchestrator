# Agent-Assisted Development Pipeline (Framework)

The reusable, repo-agnostic governance model for agent-assisted development.
The `agent-orchestrator` enforces this framework; each target repository
instantiates it with its own policy — enabled tiers, protected paths, and a
verify command — stored in that repo, not here.

> **First target repo:** [pottery-studio-system](https://github.com/jliguori1312/pottery-studio-system).
> Its instantiation is recorded in
> [issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518).

## Purpose

Let coding agents advance a repository's backlog asynchronously
(issue → plan → PR) while preserving full human ownership, review, and
understanding of the codebase.

**Hard non-goal:** No autonomous issue → merge. Auto-merge is prohibited.

## 1. Scope

- Applies to any repository that opts in by adding `.github/agent.yml` plus the
  `scripts/agent/` policy files.
- Covers: issue triage, plan generation, sandboxed implementation, PR creation,
  remote back-and-forth, human review.
- Excludes (human-only): whatever the target repo declares out of scope for
  agents — typically schema/migrations, security/auth/billing internals, and
  hardware/infra.

## 2. Autonomy tiers

| Tier | Task class | Autonomy | Required gates |
|---|---|---|---|
| 0 | Mechanical (dep bumps, lint/format, type errors, docs sync, dead code) | High (draft PR) | G2, G3, S1, S3, S5 |
| 1 | Tests (add coverage for existing behavior) | High (draft PR) | G2, G3, G5, S1 |
| 2 | Small UI/content (component, block, copy) | Medium (draft PR) | G1, G2, G3, G5, S1 |
| 3 | Localized bugfix (single-module bug with reproduction) | Medium (draft PR) | G1, G2, G3, G5, S1, S2 |
| 4 | Refactor (consolidate duplicates, extract helpers) | Low (draft PR) | G1–G7, S1, S2 |
| 5 | Cross-cutting | Human-led; agent assists only | all gates |
| 6 | Schema/migrations | Human-led | all gates |
| 7 | Security/sensitive | Agent forbidden | — |
| 8 | Hardware/infra | Agent forbidden | — |
| 9 | Generated files | Never hand-edited | P4 |

Each target repo's `.github/agent.yml` declares which tiers are agent-eligible
(typically 0–3) and any tier-specific overrides.

## 3. Checks and balances (non-negotiable)

### Review gates

- **G1 — Plan gate.** No implementation before a written plan is approved by
  the human (`/approve-plan` on the issue). The plan states restated task,
  acceptance criteria, files to touch, out-of-scope risks, test strategy.
- **G2 — Required CI.** Lint, typecheck, test, and generated-types freshness
  (where applicable) must pass on the PR. Branch protection makes them required.
- **G3 — Required human review; never auto-merge.** Every agent PR is merged
  only by a human. Agents cannot approve or merge.
- **G4 — Adversarial second review.** A different model reviews the diff
  against the spec and posts **questions, not verdicts**. It expands the human
  review; it never substitutes for G3.
- **G5 — Tests-first review.** The human reads test changes before
  implementation changes. Watch for weakened assertions and
  pass-on-broken-code tests.
- **G6 — Explain-back.** Before merge, the human writes one paragraph in their
  own words describing what changed and why. Cannot do it → do not merge.
- **G7 — Change dossier.** Every agent PR includes: restated task; acceptance
  criteria; files touched and why; flagged out-of-scope edits; test evidence
  (commands + output + commit SHA); risk list (contracts/invariants/blast
  radius); rollback plan.

### Scope limits

- **S1 — Diff budget.** ≤300 changed lines and ≤10 files per PR (configurable
  per repo). Over budget → the agent must split.
- **S2 — Blast-radius rule.** Any PR touching more than one module, shared
  packages, CI/infra config, schema, or migrations is human-led, not
  agent-driven.
- **S3 — Protected paths.** Agents may not modify paths listed in the target
  repo's `scripts/agent/protected-paths.txt`.
- **S4 — Per-stage tool allowlist.** Triage: `read,grep,find,ls`. Implement:
  add `edit,write,bash`. Enforced via `pi --tools` / `--exclude-tools`.
- **S5 — One issue = one PR.** No drive-by changes, no unrelated cleanup.

### Security

- **SEC1 — Rule of Two.** Agent = repo write + untrusted input + external
  comms. This combination requires a human in the loop: no auto-merge, no
  deploy trigger.
- **SEC2 — Trusted actors only.** Only collaborators may apply the `agent-ready`
  label. Never trigger from arbitrary user comments.
- **SEC3 — Least-privilege tokens.** Agent jobs hold no production secrets.
  Deploy credentials stay in separate, human-triggered workflows.
- **SEC4 — Sandbox isolation.** Run the agent in a container/micro-VM with
  minimal mounts; restrict egress to the public internet (block private,
  link-local/metadata, and the host). Never run the agent with host
  credentials.
- **SEC5 — Pin actions by SHA.** All third-party GitHub Actions pinned to
  commit SHAs.
- **SEC6 — Treat all issue/PR text as untrusted.** No `pull_request_target`;
  no interpolating untrusted text into `run:` blocks.
- **SEC7 — Audit trail.** Persist agent session JSONL as a run artifact for
  every run.
- **SEC8 — Enforce protected paths at the tool layer,** not just in review.

### Ownership

- **O1 — Hand-written core.** Security, financial, and physical-access code
  stays human-authored. Agents may read/suggest/test only.
- **O2 — ADR / decision log.** Every architectural decision gets an entry in
  `docs/adr/`.
- **O3 — Weekly ledger ritual.** 30–60 min weekly: review agent PRs, refresh
  AGENTS.md, remove dead abstractions, log decisions.
- **O4 — Context upkeep.** AGENTS.md, module docs, and specs updated whenever
  behavior or structure changes.
- **O5 — No un-explainable code.** If the human cannot explain a merged change,
  it gets reverted or rewritten.

### Process

- **P1 — Phase gates.** Do not start a phase until the previous phase's exit
  criteria are met.
- **P2 — Metrics + kill criteria.** See §7. If metrics regress, pause the
  pipeline.
- **P3 — Rollback plan per PR.** Every PR states how to revert safely.
- **P4 — Generated files.** Generated output must produce no diff on CI;
  agents never hand-edit it.

## 4. Phases

- **Phase 0 — Verification substrate.** CI, branch protection, a verify script,
  and protected-path list exist before any agent touches code.
- **Phase 1 — Read-only triage.** On `agent-ready`, a read-only agent posts a
  plan + risk assessment. No code, no branch.
- **Phase 2 — Plan-gated PRs (Tiers 0–3).** Worktree isolation, scoped tools,
  plan gate, diff budget, dossier, draft PR, **human merge**.
- **Phase 3 — Measurement and controlled expansion.** Track metrics; widen
  scope only where numbers hold.

## 5. Target architecture

```
GitHub Issue (label: agent-ready, collaborator only)
        |
        v
[1] Triage session  - pi --tools read,grep,find,ls
        |              posts plan comment; label needs-human-plan-approval
        |  human: /approve-plan
        v
[2] Implement session - isolated git worktree, scoped tools
        |               - enforces protected paths (S3) + diff budget (S1)
        |               - runs scripts/agent/verify.sh
        |               - asks questions via gh issue comment (label needs-human)
        |               - opens DRAFT PR with dossier (G7)
        v
[3] CI gate (G2) - required checks
        v
[4] Adversarial review session (G4) - different model, questions only
        v
[5] Human review (G3, G5, G6) -> merge  (never automated)
```

## 6. Target-repo policy

Each repository that the orchestrator serves supplies, in its own tree:

- `.github/agent.yml` — enabled tiers, diff budget, protected-path globs,
  plan-gate on/off, review model.
- `scripts/agent/protected-paths.txt` — the S3 list.
- `scripts/agent/verify.sh` — the single source of truth for "green" (mirrors
  that repo's CI).

## 7. Metrics and kill criteria

Track per PR: review minutes, rework %, reverts, CI-failure rate, diff size,
tier, and whether the human could explain the change (G6 pass/fail).

Healthy:

- Review minutes per merged PR trending down.
- Zero reverts from agent PRs.
- Zero incidents attributable to agent code.
- ≥5 consecutive PRs passing G1–G7.

Pause/kill the pipeline if any of:

- Any agent PR merges without required review.
- Any revert or production incident traced to agent code.
- Review time per PR trending up for two consecutive weeks.
- Agents repeatedly attempt protected-path or out-of-scope edits.
- A security finding in the agent job path.

## 8. Related

- Build plan: [agent-orchestrator-plan.md](./agent-orchestrator-plan.md)
- Decisions: [docs/adr/](./adr/)
- Config reference: [config-reference.md](./config-reference.md)
