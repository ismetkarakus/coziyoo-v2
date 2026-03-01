# Coziyoo

Monorepo for Coziyoo platform with npm workspaces.

## Project Structure

```
coziyoo/
├── .env                    # Centralized environment configuration
├── package.json            # Root workspace configuration
├── apps/
│   ├── api/               # Backend API (Node.js/Express)
│   ├── admin/             # Admin panel (React + Vite)
│   └── web/               # Customer web/mobile app (Expo)
├── packages/
│   ├── shared-types/      # Shared TypeScript types
│   └── shared-utils/      # Shared utility functions
└── installation/          # Deployment scripts
```

## Quick Start (Local Development)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values
```

### 3. Run Development

```bash
# API only (http://localhost:3000)
npm run dev:api

# Admin panel only (http://localhost:5173)
npm run dev:admin

# Web/mobile app
npm run dev:web
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all workspaces |
| `npm run dev:api` | Start API in dev mode |
| `npm run dev:admin` | Start Admin panel in dev mode |
| `npm run dev:web` | Start Web app in dev mode |
| `npm run build:api` | Build API only |
| `npm run build:admin` | Build Admin only |
| `npm run build:web` | Build Web for production |
| `npm run test` | Run tests in all workspaces |
| `npm run test:api` | Run API tests only |

## Production Deployment

See [installation/README.md](installation/README.md) for VPS deployment instructions.

```bash
# On VPS - First time setup
bash installation/scripts/install_all.sh

# On VPS - Updates
bash installation/scripts/update_all.sh
```

## Default Credentials

After installation, the admin panel is available at your configured domain with:
- **Email:** `admin@coziyoo.com`
- **Password:** `Admin12345`

## Architecture

### Services (Production)

| Service | Type | Port | Description |
|---------|------|------|-------------|
| `coziyoo-api` | systemd | 3000 | Node.js/Express API |
| `coziyoo-admin` | systemd | 8000 | Python HTTP server (admin panel) |
| `postgresql` | systemd | 5432 | PostgreSQL database |
| `nginx-proxy-manager` | Docker | 80/443/81 | Nginx Proxy Manager (ingress) |

### External Access

Nginx Proxy Manager routes external traffic:
- `api.yourdomain.com` → `http://127.0.0.1:3000`
- `admin.yourdomain.com` → `http://127.0.0.1:8000`

## Environment Configuration

Application configuration is centralized in the root `.env` file:

- **API settings:** `API_PORT`, `*_SECRET` keys
- **Database:** `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- **External services:** `PAYMENT_WEBHOOK_SECRET`, `AI_SERVER_*`, etc.

Installation-specific settings are in `installation/config.env`.

## Workspace Commands

```bash
# Install package in specific app
npm install some-package --workspace=apps/api

# Run script in specific app
npm run test --workspace=apps/api

# Add shared package as dependency
npm install @coziyoo/shared-types --workspace=apps/api
```

## Adding New Packages

1. Create directory in `packages/my-package/`
2. Add `package.json` with `"name": "@coziyoo/my-package"`
3. Run `npm install` at root
4. Use in apps: `npm install @coziyoo/my-package --workspace=apps/api`
