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
