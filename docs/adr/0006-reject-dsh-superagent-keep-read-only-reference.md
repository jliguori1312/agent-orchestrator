# ADR-0006: Reject dsh-superagent; keep it as read-only reference (like Orbi)

- **Status:** Accepted
- **Date:** 2026-11-05
- **Deciders:** Repository owner
- **See also:** [ADR-0001](./0001-build-thin-orchestrator-on-pi.md) (reject the
  Orbi dependency; Pi is the only agent dependency), [ADR-0003](./0003-orchestrator-authenticates-as-github-app.md)
  (GitHub App identity), [the orchestrator build plan](../agent-orchestrator-plan.md)
  (§2 non-goals, §5 components), [the pipeline framework](../agent-assisted-development-pipeline.md)
  (G1, G3, S1, S3/SEC8, SEC4)

## Context

Periodically we re-run the "finish it vs. adopt something off the shelf" test
against new tools, sunk cost excluded, as we did for Orbi. This record is the
2026-11 pass over
[dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype), a
DeepSeek-published "proactive coding agent for one GitHub repository."

What it is, factually:

- A **DeepSeek Harness (DSH) bundle**, not a standalone orchestrator: a plugin
  that listens to GitHub (and optionally Feishu), evaluates requests under a
  Policy, opens Tickets, executes each in a **DSH session**, and replies in the
  original thread, e.g. with a pull request. It drives DSH sessions, not Pi
  sessions, so it is incompatible with ADR-0001's "Pi is the only agent
  dependency."
- Every runtime peer is an alpha/rc platform package
  (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-session`,
  ~20 more, all `^0.2.1-alpha.2`), with `engines.dsh ^0.2.1-alpha.2`. MIT
  licensed; DeepSeek Harness itself is open source, so licensing and
  platform-openness are **not** the objection.
- The README states: *"Research prototype for reference only, not an official
  DeepSeek product… research code, not production-ready software."*

Repository health, measured 2026-11-05:

| | Orbi (rejected, ADR-0001) | dsh-superagent |
|---|---|---|
| Age | ~6 weeks | ~5 days (created 2026-10-31) |
| Commits | 2,050 in 6 weeks | 1 (single squashed "research prototype" commit) |
| Human contributors | ~1 | 0 (author is `team@dsh.dev`) |
| Stars / forks / watchers | 212 / 24 / 0 | 19,306 / 2,198 / 140 |
| Issues / discussions / wiki | open | **disabled** (`has_issues: false`), none, none |
| Releases | 91 | 0 |

The star count is a brand halo, not community: issues are disabled, so there is
no place to file bugs or track fixes, and the "community" is a handful of
3–20-star translations and forks. One squashed commit from a team address
means no history, no named maintainer, no release cadence.

Its governance model conflicts with the framework's non-negotiables, in the
same way Orbi's did:

- **G1 plan gate — absent.** No human approval of a written plan before
  implementation; the agent "stops by impact, not effort" and asks through a
  structured question. No `/approve-plan` equivalent as a gate.
- **S3/SEC8 protected paths — absent.** Only command-name blocking
  (`blockedCommands`), which its own docs call "defaults, **not a security
  boundary**."
- **S1 diff budget — absent** as host enforcement; the 200-line number gates
  only a prompt's auto-merge hint.
- **G2 verify command — absent.** No target-repo `verify.sh`; it relies on CI
  and branch protection alone.
- **G4 adversarial second review — absent.** A separate `eval` model performs
  *admission*, not diff review.
- **SEC4 sandbox isolation — absent.** Both presets run `danger-full-access`
  as the operator's OS user, can read the operator's home directory, and have
  no container/VM boundary or egress policy. Isolation is "use a dedicated OS
  account."
- **ADR-0003 GitHub App identity — explicitly rejected.** *"A GitHub App
  cannot be the agent, because dsh-superagent reads the account's
  notifications."* It requires a dedicated GitHub **user** account signed into
  `gh` (a PAT), losing bot attribution, installation scoping, short-lived
  tokens, and the no-ruleset-bypass guarantee.
- **G3 no auto-merge — soft only.** Off by default, but "the host has no
  merge-specific decision logic" — it is prompt text, toggleable by config.
  Our design physically never calls merge.
- **SEC2 trusted actors — different model.** A team-maintained allowed list
  plus an admission table and accept modes (`off`/`observe`/`auto`), not our
  "collaborator applied the label" check.

Modification cost, sunk cost excluded: the reusable core is ~2,088 LOC of
`src/core/` (the Ticket/Mandate/Eval/Strength domain model) plus
`docs/001–003` and ~14k LOC of tests as an edge-case catalog. Decoupling it
from DSH means rewriting ~13k LOC (`src/app/` React panel + API, `src/client/`,
`src/executor/dsh.ts`, the Feishu sources, the DSH presets) to drive Pi +
`gh` + git worktrees + systemd — which is precisely our remaining M2/M3 —
and then *adding* the governance above on top. Net effort is ≥ finishing M2/M3
on a shakier alpha foundation.

## Decision

**We will not adopt, fork, or wrap dsh-superagent.** We continue building the
thin orchestrator on Pi (ADR-0001 unchanged), and demote dsh-superagent to
**read-only reference material** alongside Orbi: its domain model and tests
are a good map of the state-machine edge cases in C3/C8/C13/C14, but it is not
a dependency and its runtime is not installed on the host.

## Consequences

### Positive

- No alpha/rc platform SDK in the dependency tree; Pi remains the only agent
  dependency.
- No new identity model: the GitHub App (ADR-0003) and the SEC4 isolation
  boundary stay as designed.
- A second, well-documented reference for the run/ticket state machine, with a
  richer authorization model than Orbi offered (strength, stop/resume,
  revalidation-before-resume).

### Negative / trade-offs

- We give up a domain model that is more complete than ours at the same
  maturity point, and its ~14k LOC of tests; we regain them only by reading,
  not by importing.

### Follow-up

- Consult `docs/001–003` and `tests/` of dsh-superagent when designing C3
  (run registry), C8 (plan gate), C13 (merge handoff) and C14 (journal)
  edge cases.
- No dependency and no DSH runtime on the host.
