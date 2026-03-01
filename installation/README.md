# Installation and Operations (Optional Docker for NPM)

This folder provides an automated deployment workflow for:

- Admin panel (static publishing + NPM or Nginx ingress)
- API (Node.js + Express as a managed service)
- Postgres (service)
- LiveKit server (first install, then service control)
- Nginx Proxy Manager (optional, Docker-based)

Plan reference: `installation/PLAN.md`
NPM guide: `installation/NPM_PROXY_SETUP.md`

## 1) Quick start

1. Copy config template:

```bash
cp installation/config.env.example installation/config.env
```

2. Edit `installation/config.env` for your VPS paths/domains/secrets.
   LiveKit installation is selected interactively during `install_all.sh`.
   Values with spaces must be quoted, for example:
   `API_START_CMD="node dist/src/server.js"`.
   Default deployment path is `/opt/coziyoo`, and API/Admin services run as `root`.
   For this production setup use:
   - `INGRESS_MODE=npm`
   - `INSTALL_NGINX=false`
   - `INGRESS_MODE=npm` (auto-installs Nginx Proxy Manager via Docker)

3. Run first installation:

```bash
bash installation/scripts/install_all.sh
```

## 2) Daily update command (server side)

```bash
bash installation/scripts/update_all.sh
```

This command updates code, rebuilds API/admin, restarts services, and runs health checks.
When `INGRESS_MODE=npm`, it also runs public domain validation.
In `INGRESS_MODE=npm`, admin panel is served by the `coziyoo-admin` python service on `0.0.0.0:${ADMIN_PORT:-8000}` (default `8000`) for Nginx Proxy Manager upstream.

## 3) Service control

All services:

```bash
bash installation/scripts/run_all.sh status
bash installation/scripts/run_all.sh restart
```

Single service:

```bash
bash installation/scripts/run_all.sh status api
bash installation/scripts/run_all.sh logs admin
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
- LiveKit on Linux: Docker Compose under `/opt/livekit` (managed by `livekit-docker` service)
- macOS services: `launchd`
- API runtime: `node dist/src/server.js`
- Keep separate env files per service.
