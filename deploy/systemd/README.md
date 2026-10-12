# systemd units

Host-side units for the orchestrator's ~5-minute tick. They implement
[ADR-0004](../../docs/adr/0004-run-orchestrator-as-hardened-system-unit.md): a
**system** unit under PID 1 running as a dedicated unprivileged user — no user
units, no `loginctl enable-linger`.

## Install

```bash
sudo install -m 0644 agent-orchestrator.service agent-orchestrator.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/agent-orchestrator.service /etc/systemd/system/agent-orchestrator.timer
sudo systemctl daemon-reload
sudo systemctl enable --now agent-orchestrator.timer
```

Until M1's entrypoint exists, `ExecStart` points at a placeholder
(`dist/main.js`); leave the timer disabled or expect one failed unit per tick.
The M0 exit criterion is `verify.sh` green in-host, not the orchestrator
running.

The service runs the compiled entrypoint, so build once (and rebuild on every
deploy) from the checkout:

```bash
pnpm install --frozen-lockfile
pnpm build          # emits dist/main.js — the ExecStart target
```

## Prerequisites

- Unprivileged service user `agent-orchestrator` (no login), owning
  `/var/lib/agent-orchestrator`.
- `/etc/agent-orchestrator/` (`root:root`, mode 0700) holding the secret files
  `app.pem`, `<provider>.key`, and `cloudflare.token` (each `root:root` mode
  0600), loaded via `LoadCredential=` — not environment variables. The model
  key file follows `model.provider`: name it `<provider>.key` and load it as
  the credential `<provider>-key`.
- `orchestrator.jsonc` (gitignored) in the code checkout, holding the non-secret
  config (targets, GitHub App IDs, models, workspace, verify command).
- The target repo cloned **read-only** at `<workspace.root>/<repo-name>` (M1
  substrate: the tick's read-only sessions inspect this checkout). C4 owns the
  writable worktree lifecycle in M2; the tick treats a missing clone as a hard
  error.
- Node 24 installed **system-wide** so `/usr/bin/node` resolves (a `nvm`-only
  Node is invisible to systemd).

## Inspect

```bash
sudo systemctl status agent-orchestrator.timer
sudo systemctl list-timers agent-orchestrator.timer
journalctl -u agent-orchestrator.service -f
```
