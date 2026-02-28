# Installation and Operations (No Docker)

This folder provides an automated deployment workflow for:

- Admin panel (static publishing + NPM or Nginx ingress)
- API (Node.js + Express as a managed service)
- Postgres (service)
- LiveKit server (first install, then service control)
- Agent (Python managed service)

Plan reference: `installation/PLAN.md`
NPM guide: `installation/NPM_PROXY_SETUP.md`

## 1) Quick start

1. Copy config template:

```bash
cp installation/config.env.example installation/config.env
```

2. Edit `installation/config.env` for your VPS paths/domains/secrets.
   `INSTALL_LIVEKIT` supports `ask`, `true`, or `false`.
   Values with spaces must be quoted, for example:
   `API_START_CMD="node dist/src/server.js"` and `AGENT_START_CMD="python src/agent_http_runner.py"`.
   Default deployment path is `/opt/coziyoo`, and API/Agent services run as `root`.
   For this production setup use:
   - `INGRESS_MODE=npm`
   - `INSTALL_NGINX=false`

3. Run first installation:

```bash
bash installation/scripts/install_all.sh
```

## 2) Daily update command (server side)

```bash
bash installation/scripts/update_all.sh
```

This command updates code, rebuilds API/admin, updates agent deps, restarts services, and runs health checks.
When `INGRESS_MODE=npm`, it also runs public domain validation.

## 3) Service control

All services:

```bash
bash installation/scripts/run_all.sh status
bash installation/scripts/run_all.sh restart
```

Single service:

```bash
bash installation/scripts/run_all.sh status api
bash installation/scripts/run_all.sh logs agent
```

## 4) GitHub auto-deploy

Use `.github/workflows/vps-deploy.yml` to run update over SSH on push to `main`.

Required secrets:

- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY`

Remote command should be:

```bash
cd /opt/coziyoo
bash installation/scripts/update_all.sh
```

## 5) Notes

- Linux services: `systemd`
- macOS services: `launchd`
- API runtime: `node dist/src/server.js`
- Keep separate env files per service.
- Agent runtime default is `python src/agent_http_runner.py` and exposes `/health`.
