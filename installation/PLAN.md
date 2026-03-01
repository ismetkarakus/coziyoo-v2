# Automated Non-Docker Deployment Plan (Linux VPS, Node/Express API)

## Summary

Build a fully automated install/update/run system under `installation/` with:

- Per-service scripts (`admin`, `postgres`, `api`, `nginx`)
- One orchestrator for first-time setup (`install_all.sh`)
- One orchestrator for ongoing updates (`update_all.sh`)
- One orchestrator for operations (`run_all.sh` with `start|stop|restart|status|logs`)
- GitHub auto-deploy on push to `main` that runs `update_all.sh` on VPS over SSH

This keeps the API on Node.js + Express and avoids Docker for the application.

## Architecture

- **External Ingress**: Nginx Proxy Manager (Docker) handles TLS and routing
- **Internal Services**: Native systemd services (API, PostgreSQL)
- **Static Files**: Local nginx serves admin panel on port 8000

## Script layout

- `scripts/install_all.sh` - Main installation orchestrator
- `scripts/update_all.sh` - Main update orchestrator
- `scripts/run_all.sh` - Service operations
- `scripts/install_prereqs.sh` - System packages
- `scripts/install_postgres.sh` - PostgreSQL setup
- `scripts/install_api_service.sh` - API service
- `scripts/install_admin_panel.sh` - Admin panel build + nginx config
- `scripts/install_nginx.sh` - Local nginx for static files
- `scripts/install_npm_proxy_manager.sh` - NPM (Docker)
- `scripts/update_api_service.sh` - API update
- `scripts/update_admin_panel.sh` - Admin update
- `scripts/common.sh` - Shared functions

## Config contract

The control plane is `installation/config.env`:

- Global: repo path, branch, git update behavior
- Toggles for each install step
- Service names and run users
- Per-service env file paths
- NPM settings and domains
- PostgreSQL credentials

## Install flow (`install_all.sh`)

1. Install prerequisites
2. Install Nginx Proxy Manager
3. Start/configure PostgreSQL
4. Build/migrate and install API service
5. Build admin panel and configure nginx

## Update flow (`update_all.sh`)

1. Acquire deploy lock
2. Stop services
3. Update API (`npm ci`, `npm run build`, restart)
4. Update Admin (build + publish)
5. Run API health check
6. Validate NPM domains

## Run flow (`run_all.sh`)

- Supported actions: `start`, `stop`, `restart`, `status`, `logs`
- Scope: all services or single service (`api`, `nginx`, `postgres`)

## Acceptance criteria

- Fresh Linux install results in all services active.
- Re-running install is safe and idempotent.
- Push to `main` triggers auto-deploy and health check.
- Manual run operations work consistently.

## Assumptions

- Default server path is `/opt/coziyoo`.
- API code is repository root (`API_DIR=.`).
- Services run as `root` (configure API_RUN_USER for production).
