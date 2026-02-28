# Automated Non-Docker Deployment Plan (Linux + macOS, Node/Express API)

## Summary

Build a fully automated install/update/run system under `installation/` with:

- Per-service scripts (`admin`, `postgres`, `api`, `agent`, `livekit`, `nginx`)
- One orchestrator for first-time setup (`install_all.sh`)
- One orchestrator for ongoing updates (`update_all.sh`)
- One orchestrator for operations (`run_all.sh` with `start|stop|restart|status|logs`)
- GitHub auto-deploy on push to `main` that runs `update_all.sh` on VPS over SSH

This keeps the API on Node.js + Express and avoids Docker.

## Locked decisions

- Linux and macOS are both supported.
- API runtime is compiled TypeScript + Node (`node dist/src/server.js`).
- Deployment mode is GitHub auto-deploy.
- LiveKit is installed on first setup only; later workflows only control the service.

## Script layout

- `scripts/install_all.sh`
- `scripts/update_all.sh`
- `scripts/run_all.sh`
- `scripts/install_prereqs.sh`
- `scripts/install_postgres.sh`
- `scripts/install_livekit_service.sh`
- `scripts/install_api_service.sh`
- `scripts/install_agent_service.sh`
- `scripts/install_admin_panel.sh`
- `scripts/install_nginx.sh`
- `scripts/update_api_service.sh`
- `scripts/update_agent_service.sh`
- `scripts/update_admin_panel.sh`
- `scripts/common.sh`

## Config contract

The control plane is `installation/config.env`:

- Global: repo path, branch, git update behavior
- Toggles for each install step
- Service names and run users
- Per-service env file paths
- LiveKit binary and config values
- Nginx domains and API proxy port
- Optional Postgres bootstrap credentials

Runtime env remains split by service (`API_ENV_FILE`, `AGENT_ENV_FILE`, LiveKit config).

## Install flow (`install_all.sh`)

1. Install prerequisites
2. Start/configure PostgreSQL
3. Install/configure LiveKit service (skip binary if exists)
4. Build/migrate and install API service
5. Install Agent service
6. Build and publish Admin static files
7. Write/test/reload Nginx

## Update flow (`update_all.sh`)

1. Acquire deploy lock
2. Update API (`npm ci`, `npm run build`, `npm run db:migrate`, restart)
3. Update Agent (venv + install, restart)
4. Update Admin (build + publish + nginx reload)
5. Run API health check

## Run flow (`run_all.sh`)

- Supported actions: `start`, `stop`, `restart`, `status`, `logs`
- Scope: all services or single service (`api`, `agent`, `livekit`, `nginx`, `postgres`)

## Acceptance criteria

- Fresh Linux install results in all services active.
- Fresh macOS install creates launch agents and starts services.
- Re-running install is safe and idempotent.
- Push to `main` triggers auto-deploy and health check.
- Manual run operations work consistently.

## Assumptions

- Default server path is `/opt/coziyoo`.
- API code is repository root (`API_DIR=.`).
- TLS/Certbot is out of initial scope.
