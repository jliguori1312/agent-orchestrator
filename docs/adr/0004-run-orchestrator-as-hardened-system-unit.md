# ADR-0004: Run the orchestrator as a hardened system unit (not user units + linger)

- **Status:** Accepted
- **Date:** 2026-10-11
- **Deciders:** Repository owner
- **Amends:** [ADR-0002](./0002-orchestrator-runtime-decisions.md) D1 (isolation host) and D2 (scheduler)
- **See also:** [the orchestrator build plan](../agent-orchestrator-plan.md) (§3 topology, §4 decisions), [the pipeline framework](../agent-assisted-development-pipeline.md) (SEC4, SEC7), [ADR-0003](./0003-orchestrator-authenticates-as-github-app.md)

## Context

ADR-0002 D1 chose "an unprivileged LXC (systemd + linger)" as the isolated
host, and D2 chose a ~5-minute systemd timer as the scheduler. The
"systemd + linger" phrasing implies the orchestrator runs as a **user** unit
under `systemd --user`, kept alive across logins by `loginctl enable-linger`.

Linger is not an alternative to a unit; it is a per-user flag that keeps the
*user manager* running without a login session. It is only required when the
unit is owned by the user manager. Reviewing that choice against the rest of
the design surfaced three problems:

1. **Tamper surface.** The implement stage grants the session `bash` (S4),
   running as the same service account that would own `~/.config/systemd/user`.
   The user-unit search path puts `~/.config/systemd/user` *above*
   `/etc/systemd/user` (verified against systemd 257 on Debian 13), so even a
   root-owned user unit can be shadowed by the account the agent controls. A
   prompt-injected agent could therefore define or rewrite units and — with
   linger — obtain boot-time execution outside the orchestrator's control and
   outside its journal (SEC7). It is not a root escalation, but it is a
   persistence and containment escape.
2. **Lost hardening.** The user manager runs unprivileged, so most sandboxing
   directives (`ProtectSystem=`, `ProtectHome=`, `PrivateTmp=`, …) do not
   apply to user units. A system unit under PID 1 can use the full set.
3. **Ergonomics and ordering.** Administering a bot user's units needs
   `machinectl shell` / `XDG_RUNTIME_DIR` gymnastics, and
   `After=network-online.target` in a user unit is unreliable because the
   system target is not active in the user manager.

## Decision

The orchestrator runs as a **systemd system unit** under PID 1:

- A `Type=oneshot` service at `/etc/systemd/system/agent-orchestrator.service`
  with a dedicated unprivileged `User=` / `Group=agent-orchestrator`, driven by
  a system `.timer` (~5 min tick, single slot). The unit files are owned by
  root in `/etc/systemd/system/` and are not writable by the service account.
- **No linger, no user units.** Linger exists only to keep user units alive and
  buys nothing here.
- **Moderate sandboxing now** (`NoNewPrivileges=`, `ProtectSystem=strict`,
  `ProtectHome=`, `PrivateTmp=`, `ReadWritePaths=`, the kernel-related
  protections, `UMask=`) plus a memory cap and low scheduling priority. Stricter
  controls (`RestrictNamespaces=`, `RestrictAddressFamilies=`,
  `SystemCallFilter=`, `MemoryDenyWriteExecute=`) are deferred: `verify.sh`
  spawns the target repo's entire toolchain, and over-restriction would break
  the M0 "`verify.sh` green in-host" exit. `MemoryDenyWriteExecute=` is
  permanently excluded — it breaks V8's JIT.

Templates live in [`deploy/systemd/`](../../deploy/systemd/).

## Consequences

### Positive

- The unit and timer are not writable by the account the agent's `bash` runs
  as, closing the persistence/containment vector.
- Full systemd hardening and resource control are available.
- Reliable boot/network ordering and simple administration (`sudo systemctl …`).
- One fewer moving part (no linger, no user manager).

### Negative / trade-offs

- Unit changes require root (via the repo templates + `daemon-reload`) rather
  than `systemctl --user`.
- The manifest is `User=agent-orchestrator`, so that user must exist before
  first start.

### Follow-up

- Install the templates and validate with `systemd-analyze verify`.
- Amend the build plan's "systemd + linger" wording (§3) and ADR-0002 D1/D2.
- Revisit stricter sandboxing once `verify.sh`'s toolchain needs are known
  (M1); consider `DynamicUser=` + `StateDirectory=` as M3 hardening.
