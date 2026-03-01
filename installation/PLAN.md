# Coziyoo Deployment Architecture

## Overview

Production deployment uses:
- **Nginx Proxy Manager** (Docker) for external ingress (TLS, routing)
- **Systemd services** for applications (API, Admin, PostgreSQL)
- **Python HTTP server** for serving admin static files
- **Node.js/Express** for API

## Service Architecture

```
Internet
    ↓
Nginx Proxy Manager (Docker: 80/443)
    ├──→ API (systemd: 127.0.0.1:3000)
    └──→ Admin (systemd: 127.0.0.1:8000) [Python HTTP]
    
PostgreSQL (systemd: 127.0.0.1:5432)
```

## Services

### 1. API (`coziyoo-api`)
- **Type:** Systemd service
- **Runtime:** Node.js/Express
- **Port:** 127.0.0.1:3000
- **Working Dir:** `/opt/coziyoo/apps/api`
- **Start:** `node dist/src/server.js`

### 2. Admin Panel (`coziyoo-admin`)
- **Type:** Systemd service  
- **Runtime:** Python HTTP server
- **Port:** 127.0.0.1:8000
- **Working Dir:** `/var/www/coziyoo-admin`
- **Start:** `python3 -m http.server 8000 --bind 0.0.0.0`

### 3. PostgreSQL
- **Type:** Systemd service
- **Port:** 127.0.0.1:5432

### 4. Nginx Proxy Manager
- **Type:** Docker container
- **Ports:** 80, 443 (public), 81 (admin UI)
- **Config:** `/opt/nginx-proxy-manager/docker-compose.yml`

## Install Flow

1. **install_prereqs.sh** - Install git, node, python, postgres
2. **install_npm_proxy_manager.sh** - Start NPM Docker container
3. **install_postgres.sh** - Configure PostgreSQL
4. **install_api_service.sh**:
   - npm ci
   - npm run build
   - Run SQL migrations
   - Create systemd service
   - Start service
   - Wait for API health
   - Seed admin user
   - Optionally seed sample data
5. **install_admin_panel.sh**:
   - npm ci
   - npm run build
   - Copy to `/var/www/coziyoo-admin`
   - Create Python HTTP systemd service
   - Start service

## Configuration Files

### Root `.env` (Application config)
```
API_PORT=3000
PGHOST=127.0.0.1
PGUSER=coziyoo
...
```

### `installation/config.env` (Install config)
```
REPO_ROOT=/opt/coziyoo
API_DIR=apps/api
ADMIN_DIR=apps/admin
SEED_SAMPLE_DATA=false
...
```

## Security

- All services bind to localhost (127.0.0.1) except NPM
- NPM handles SSL termination
- PostgreSQL uses pgcrypto for password hashing
- No local nginx (removed in favor of NPM + Python HTTP)

## Data Seeding

**During install only:**
- Admin user: `admin@coziyoo.com` / `Admin12345`
- Sample data: buyers, sellers, foods, orders (if `SEED_SAMPLE_DATA=true`)

**Not during updates** - database remains untouched on deploy.
