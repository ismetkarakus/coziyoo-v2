# Installation and Operations

Automated deployment for Coziyoo platform on Linux VPS.

## Architecture

| Service | Type | Port | Purpose |
|---------|------|------|---------|
| `coziyoo-api` | systemd | 3000 | Node.js/Express API |
| `coziyoo-admin` | systemd | 8000 | Python HTTP server (admin panel static files) |
| `postgresql` | systemd | 5432 | Database |
| `nginx-proxy-manager` | Docker | 80/443/81 | External ingress (TLS, routing) |

External traffic flows through Nginx Proxy Manager → local services.

## Prerequisites

- Ubuntu/Debian Linux VPS
- Root or sudo access
- Domain with DNS A records pointing to VPS

## 1) Configure Installation

Copy and edit the config:

```bash
cp installation/config.env.example installation/config.env
nano installation/config.env
```

**Required changes:**
```bash
# Replace with your domain
ADMIN_DOMAIN=admin.yourdomain.com
API_DOMAIN=api.yourdomain.com

# Change passwords
PG_PASSWORD=your_secure_db_password
SEED_ADMIN_PASSWORD=your_secure_admin_password

# Optional: enable sample data seeding
SEED_SAMPLE_DATA=true
```

### Generate Root `.env` Automatically

Use the env generator to create root `.env` from `.env.example` while mirroring overlap values from `installation/config.env`:

```bash
bash installation/scripts/generate_env.sh
```

If `.env` already exists, use `--force`:

```bash
bash installation/scripts/generate_env.sh --force
```

Dry output to a temp path:

```bash
bash installation/scripts/generate_env.sh --output /tmp/coziyoo.env --force
```

## 2) First Time Install

```bash
bash installation/scripts/install_all.sh
```

This will:
1. Install system packages (git, node, python, postgres)
2. Install Nginx Proxy Manager (Docker)
3. Configure PostgreSQL
4. Build and start API (with database migrations)
5. Build and start Admin panel (Python HTTP server)

**Default admin credentials:**
- Email: `admin@coziyoo.com`
- Password: `Admin12345` (or what you set in `SEED_ADMIN_PASSWORD`)

## 3) Configure Nginx Proxy Manager

After install, access NPM UI:

```
http://your-server-ip:81
```

Default NPM login:
- Email: `admin@example.com`
- Password: `changeme`

Create proxy hosts:

| Domain | Forward Hostname | Forward Port |
|--------|-----------------|--------------|
| `api.yourdomain.com` | `127.0.0.1` | `3000` |
| `admin.yourdomain.com` | `127.0.0.1` | `8000` |

For each host:
- Enable "Block Common Exploits"
- Enable SSL (Let's Encrypt)
- Enable "Force SSL"
- Enable HTTP/2

## 4) Daily Operations

### Update (deploy new code)

```bash
bash installation/scripts/update_all.sh
```

This pulls latest code, rebuilds, and restarts services.

## 5) Auto-Deploy on Git Push (GitHub Actions)

To deploy automatically when you push to `main`, this repo includes:

- `.github/workflows/deploy-on-push.yml`

### Required GitHub Secrets

1. `DEPLOY_SSH_KEY`
   - Private SSH key with access to all target servers.
2. `DEPLOY_TARGETS`
   - Newline-separated rows in this format:

```text
name|host|user|port|repo_path
```

Example:

```text
prod-eu|203.0.113.10|root|22|/opt/coziyoo
prod-us|198.51.100.12|ubuntu|22|/opt/coziyoo
```

Notes:
- `host` can be omitted and then `name` is used as host.
- `user` defaults to `root`.
- `port` defaults to `22`.
- `repo_path` defaults to `/opt/coziyoo`.

### Optional GitHub Variable

- `DEPLOY_BRANCH` (Repository Variables)
  - Defaults to `main` if not set.

### What the workflow does

On each push to `main`, GitHub Actions:
1. Connects to each server over SSH
2. Runs:
```bash
GIT_UPDATE=true DEPLOY_BRANCH=<branch> bash installation/scripts/update_all.sh
```
3. Fails the workflow if any server update fails

### Service Control

```bash
# Check status of all services
bash installation/scripts/run_all.sh status

# Restart all services
bash installation/scripts/run_all.sh restart

# Check specific service
bash installation/scripts/run_all.sh status api
bash installation/scripts/run_all.sh status admin

# View logs
bash installation/scripts/run_all.sh logs api
```

### Database Migrations (manual)

If you need to run migrations manually:

```bash
bash installation/scripts/db-migrate.sh
```

### Data Seeding (manual)

To seed sample data after install:

```bash
# Edit config to enable
SEED_SAMPLE_DATA=true

# Run seeding
bash installation/scripts/seed-data.sh
```

## Troubleshooting

### Check service logs

```bash
journalctl -u coziyoo-api -n 100 --no-pager
journalctl -u coziyoo-admin -n 100 --no-pager
journalctl -u postgresql -n 100 --no-pager
```

### Check NPM logs

```bash
docker logs nginx-proxy-manager
```

### API health check

```bash
curl http://127.0.0.1:3000/v1/health
```

### Admin health check

```bash
curl http://127.0.0.1:8000
```

## File Locations

| Path | Description |
|------|-------------|
| `/opt/coziyoo` | Application code |
| `/opt/coziyoo/.env` | Application configuration |
| `/var/www/coziyoo-admin` | Admin panel static files |
| `/opt/nginx-proxy-manager` | NPM Docker files |
| `/etc/systemd/system/coziyoo-*.service` | Systemd services |
