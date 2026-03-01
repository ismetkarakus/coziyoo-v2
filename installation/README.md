# Installation and Operations

This folder provides an automated deployment workflow for:

- Admin panel (static files served by local nginx)
- API (Node.js + Express as a systemd service)
- PostgreSQL (systemd service)
- Nginx Proxy Manager (Docker-based, external ingress)

Plan reference: `installation/PLAN.md`
NPM guide: `installation/NPM_PROXY_SETUP.md`

## 1) Quick start

1. Copy config template:

```bash
cp installation/config.env.example installation/config.env
```

2. Edit `installation/config.env` for your VPS paths/domains/secrets.
   Values with spaces must be quoted, for example:
   `API_START_CMD="node dist/src/server.js"`.
   
   **Required changes:**
   - Replace `YOURDOMAIN.com` with your actual domain
   - Change all `CHANGE_ME_...` passwords

3. Run first installation:

```bash
bash installation/scripts/install_all.sh
```

## 2) Daily update command (server side)

```bash
bash installation/scripts/update_all.sh
```

This command updates code, rebuilds API/admin, restarts services, and runs health checks.

## 3) Service control

All services:

```bash
bash installation/scripts/run_all.sh status
bash installation/scripts/run_all.sh restart
```

Single service:

```bash
bash installation/scripts/run_all.sh status api
bash installation/scripts/run_all.sh logs nginx
```

## 4) Nginx Proxy Manager Setup

After installation:

1. Access NPM UI at `http://your-server-ip:81`
2. Create proxy hosts:
   - `api.yourdomain.com` → `http://127.0.0.1:3000`
   - `admin.yourdomain.com` → `http://127.0.0.1:8000`
3. Enable SSL for each host

## 5) Notes

- API runtime: `node dist/src/server.js`
- Admin panel: nginx serves `/var/www/coziyoo-admin` on port 8000
- NPM proxies external traffic to local services
- Keep separate env files per service.
