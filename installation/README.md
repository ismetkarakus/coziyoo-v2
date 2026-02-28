# Installation and Operations (No Docker)

This folder provides an automated deployment workflow for:

- Admin panel (Nginx static hosting)
- API (Node.js + Express as a managed service)
- Postgres (service)
- LiveKit server (first install, then service control)
- Agent (Python managed service)

Plan reference: `installation/PLAN.md`

## 1) Quick start

1. Copy config template:

```bash
cp installation/config.env.example installation/config.env
```

2. Edit `installation/config.env` for your VPS paths/domains/secrets.

3. Run first installation:

```bash
bash installation/scripts/install_all.sh
```

## 2) Daily update command (server side)

```bash
bash installation/scripts/update_all.sh
```

This command updates code, rebuilds API/admin, updates agent deps, restarts services, and runs health checks.

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
