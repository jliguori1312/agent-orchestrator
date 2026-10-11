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

## Prerequisites

- Unprivileged service user `agent-orchestrator` (no login), owning
  `/var/lib/agent-orchestrator`.
- `/etc/agent-orchestrator/environment` (`root:agent-orchestrator`, mode 0640)
  with the GitHub App, model, and read-only Cloudflare variables.
- Node 24 installed **system-wide** so `/usr/bin/node` resolves (a `nvm`-only
  Node is invisible to systemd).

## Inspect

```bash
sudo systemctl status agent-orchestrator.timer
sudo systemctl list-timers agent-orchestrator.timer
journalctl -u agent-orchestrator.service -f
```
