# ADR-0003: The orchestrator authenticates as a GitHub App, not a PAT

> **Migrated** from `pottery-studio-system` `docs/adr/0005-orchestrator-authenticates-as-github-app.md`
> on 2026-10-10 and renumbered ADR-0003 here.

- **Status:** Accepted
- **Date:** 2026-10-10
- **Deciders:** Repository owner
- **Extends:** [ADR-0001](./0001-build-thin-orchestrator-on-pi.md) (build the thin orchestrator)
- **See also:** [pottery-studio-system issue #518](https://github.com/jliguori1312/pottery-studio-system/issues/518)
  (first target repo's policy), [the orchestrator build plan](../agent-orchestrator-plan.md) (§3 topology, §9 decisions)

## Context

The build plan specified the orchestrator's GitHub identity as "a dedicated
machine account or fine-grained PAT (contents/issues/PRs RW)". Both options
 authenticate as (or act like) a human user account, which has three
problems:

1. **Ruleset bypass.** The target repo's `main` protection is a repository ruleset
   with a `pull_request` bypass for the repo-admin RepositoryRole. A PAT
   bound to the owner's account acts *as the owner* — the orchestrator would
   inherit that bypass, and agent PRs could merge without required review or
   required checks. That defeats G2/G3 in exactly the way the pipeline exists
   to prevent.
2. **Permission management.** User-scoped tokens entangle the agent's
   permissions with the owner's identity across every repo the account can
   touch; scoping and auditing them is harder than app-level installation
   permissions.
3. **Attribution.** Commits, PRs, comments, and label changes made with a
   user token are attributed to the human, not the agent. The audit trail
   (SEC7) and the human's ability to know *who opened the PR or committed*
   (G3, O5) both degrade.

A GitHub App is the identity class GitHub provides exactly for machine
actors: installation-scoped permissions, short-lived installation tokens,
no implicit ruleset bypass (apps receive bypass only if explicitly granted),
and bot attribution (`<app-name>[bot]`) on every action.

## Decision

The orchestrator authenticates to GitHub as a **dedicated GitHub App**:

- Installed only on the target repos; granted least-privilege permissions
  (contents, issues, pull requests — read/write as needed). No admin
  permissions, and **no bypass grant** on any ruleset.
- The `gh` CLI remains the GitHub interface where possible, driven by
  short-lived installation tokens (refreshed by the orchestrator; they
  expire within an hour).
- App identity applies to all orchestrator writes (commits, PRs, comments,
  labels), so every agent action is visibly attributable to the bot.

**Notifications (C15) are also delivered through the App:** on
`needs-human` (and plan-gate) transitions, the App posts the issue/PR
comment and @mentions the human, which triggers GitHub's native mobile and
email notifications. No separate ntfy/email plumbing.

## Consequences

### Positive

- No path to a branch-protection bypass: the App cannot inherit the
  owner's repo-admin bypass, and we do not grant it one.
- Least-privilege, installation-scoped permissions that are easy to audit.
- Clear bot attribution on every commit, PR, comment, and label change.
- Notifications ride GitHub's existing delivery (mobile/email) — no extra
  channel to build or monitor.

### Negative / trade-offs

- One-time App setup (App registration, private key, installation).
- The orchestrator must mint and refresh short-lived installation tokens
  (~1 h expiry) instead of using a static PAT — a small, well-understood
  component in the GitHub adapter (C2).

### Follow-up

- Create the GitHub App; install it on the first target repo
  (`pottery-studio-system`) only.
- Keep the App's private key in the orchestrator LXC only (never in a
  target repo or CI).
- Build token mint/refresh into C2 as part of milestone M1.
