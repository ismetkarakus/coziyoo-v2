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
│   └── web/               # Customer web app (Expo/React Native Web)
├── packages/
│   ├── shared-types/      # Shared TypeScript types
│   └── shared-utils/      # Shared utility functions
└── installation/          # Deployment scripts
```

## Quick Start

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
# API only
npm run dev:api

# Admin only
npm run dev:admin

# Or from individual directories
cd apps/api && npm run dev
cd apps/admin && npm run dev
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build all workspaces |
| `npm run dev:api` | Start API in dev mode |
| `npm run dev:admin` | Start Admin panel in dev mode |
| `npm run build:api` | Build API only |
| `npm run build:admin` | Build Admin only |
| `npm run test` | Run tests in all workspaces |

## Environment Configuration

All application configuration is centralized in the root `.env` file:

- **API settings**: `API_PORT`, `API_HOST`, `*_SECRET` keys
- **Database**: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- **External services**: `PAYMENT_WEBHOOK_SECRET`, `AI_SERVER_*`, etc.

Installation-specific settings remain in `installation/config.env`.

## Deployment

See [installation/README.md](installation/README.md) for deployment instructions.

```bash
# First time setup on VPS
bash installation/scripts/install_all.sh

# Daily updates
bash installation/scripts/update_all.sh
```

## Workspace Commands

Run commands in specific workspaces:

```bash
# Install package in specific app
npm install some-package --workspace=apps/api

# Run script in specific app
npm run db:migrate --workspace=apps/api

# Add shared package as dependency
npm install @coziyoo/shared-types --workspace=apps/api
```

## Adding New Packages

To add a new shared package:

1. Create directory in `packages/my-package/`
2. Add `package.json` with `"name": "@coziyoo/my-package"`
3. Run `npm install` at root
4. Use in apps: `npm install @coziyoo/my-package --workspace=apps/api`
