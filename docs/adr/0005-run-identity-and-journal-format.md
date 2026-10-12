# ADR-0005: Run identity and its on-disk audit record

- **Status:** Accepted
- **Date:** 2026-10-12
- **Deciders:** Repository owner
- **See also:** [the orchestrator build plan](../agent-orchestrator-plan.md) (§5 C3/C14, §6 marker comments), [ADR-0002](./0002-orchestrator-runtime-decisions.md) (D2 single-slot scheduler, D4 protected-path enforcement), [ADR-0004](./0004-run-orchestrator-as-hardened-system-unit.md) (SEC7 journal coverage), [the pipeline framework](../agent-assisted-development-pipeline.md) (SEC7)

## Context

Three mechanisms must agree on what a "run" is:

- C3 claims a run on GitHub through labels plus a marker comment
  `<!-- agent:run=<run_id> -->` (plan §6).
- C4 names worktrees `agent-<issue>-<run_id>` under the workspace root.
- C14 journals every orchestrator action as a `run_id`-keyed JSONL record —
  the evidence D4 leans on ("add the Pi tool-layer hook only if run journals
  show `bash`-based bypass attempts") and SEC7's audit trail.

There is no database (plan §4: state is GitHub labels + the marker comment +
on-disk JSONL), and D2's single-slot systemd timer means exactly one
orchestrator process writes at a time.

The `run_id` therefore appears in HTML comments, GitHub comment bodies,
directory names, and journal lines. It must be safe in all of those contexts,
and it must let a human correlate a worktree, a marker comment, and journal
lines without parsing anything.

## Decision

A run is identified by a **time-sortable, context-safe id**, and every action
is recorded in an **append-only, strictly validated JSONL journal**:

1. **`run_id` format: `<yymmddThhmmssZ>-<4 lowercase hex>` in UTC**
   (e.g. `261011T090312Z-a3f2`). The charset is digits, `T`, `Z`, `-`, and
   lowercase hex — no whitespace, quotes, slashes, or angle brackets — so the
   id embeds safely in worktree names and HTML comment markers. Lexicographic
   order equals chronological order, so `ls`, `sort`, and issue threads
   correlate runs by eye. The 16-bit random suffix separates starts within
   the same second: D2's single slot makes concurrent same-second starts
   impossible, so the residual case is a restart landing in the same second —
   which the journal itself makes visible. A UUID would buy global uniqueness
   this single-host system has no use for. `RUN_ID_PATTERN` is exported and
   the journal record schema validates against it, so a mangled id fails at
   the boundary instead of poisoning a marker comment or worktree name.
2. **Journal layout: append-only JSONL, sharded by UTC month** at
   `<workspace.root>/journal/YYYY-MM.jsonl`. The path is derived from
   `workspace.root` — no new config key. Zero-padded shard names sort
   chronologically; retention is a directory copy.
3. **Record shape (strict schema):** `ts` (ISO-8601 UTC with milliseconds —
   exactly `Date.toISOString()` output), `run_id`, `event`, optional `issue`
   (positive integer), optional `data` (free-form JSON object). Unknown keys
   are refused: a line that does not match the schema was hand-edited or
   corrupted, and the journal is the one place that must not be guessed at.
4. **Event taxonomy: an open set** of dotted-lowercase `namespace.name`
   identifiers (`run.claimed`, `triage.plan-posted`). M1 has no event
   producers yet (C3/C5 land later in the milestone), so a closed enum would
   be speculative; it will be tightened once real events exist.
5. **Write path: validate the serialized line before appending.** The writer
   stamps `ts` from its own injectable clock (one source of time), serializes
   the record, and schema-validates the *serialized line* first. A refused
   write throws `JournalError` and touches no disk — a line is never written
   that the reader would later reject.
6. **Read path: all-or-nothing integrity.** Every line is parsed and
   schema-validated; any corrupt or invalid line fails the whole read with
   one aggregated error naming the file and line numbers. Lines are never
   silently skipped — SEC7 asks the journal to be the record of what
   happened, and silent gaps are indistinguishable from tampering. The
   writer's own trailing newline is tolerated; an interior blank line is not.
7. **`data` is a caller contract:** values must be JSON-representable.
   `JSON.stringify` silently drops non-serializable values, and the writer's
   line validation cannot detect that, so the contract is documented here
   rather than enforced.
8. **Durability and permissions:** `O_APPEND` appends, journal directory
   `0o700`, shard files `0o600`, no `fsync` in M1 (a crash may lose the
   trailing line; GitHub-side run state remains the source of truth for
   claims). No tamper-evidence (hash chaining): SEC7 requires coverage, not
   cryptographic audit — revisit only on incident.

## Consequences

### Positive

- Runs correlate across worktrees, marker comments, and journal lines by
  string comparison alone.
- Shards stay small forever; retention and off-host copy are trivial.
- Refused writes leave no partial state; readers get every problem in one
  error instead of a silent gap.
- The injectable clock makes journal timestamps deterministic in tests.

### Negative / trade-offs

- `run_id` is unique only within a host — acceptable, since all run state is
  per-host by design (plan §4).
- A run spanning a month boundary writes into two shards; reads reassemble
  in order, so only manual `grep` notices.
- The event taxonomy is loose until tightened post-M1.
- A careless caller can silently lose a non-serializable `data` value
  (documented contract, point 7).

### Follow-up

- C3 embeds `run_id` in marker comments; C5/C6 emit the real event names.
- Tighten the event taxonomy to a closed enum after the M1 exit.
- Reconsider `fsync` or hash-chaining only if an incident demands it.
