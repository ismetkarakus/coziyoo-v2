# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Coziyoo v2 is a food-ordering marketplace platform. It is an npm workspaces monorepo containing a Node.js/Express API, React admin panel, and Expo mobile app.

## Common Commands

### Local Development

```bash
npm install                  # Install all workspaces
cp .env.example .env         # First-time env setup

npm run dev:api              # API on http://localhost:3000
npm run dev:admin            # Admin panel on http://localhost:5174
npm run dev:mobile           # Mobile via Expo (apps/mobile)
```

### Building

```bash
npm run build                # Build all workspaces
npm run build:api            # API only (tsc)
npm run build:admin          # Admin only (Vite)
```

### Testing

```bash
npm run test                 # All workspaces
npm run test:api             # API unit tests (Vitest)
npm run test --workspace=apps/api -- --run src/path/to/file.test.ts  # Single test file
```

### Database

```bash
bash installation/scripts/db-migrate.sh   # Run pending SQL migrations
bash installation/scripts/seed-data.sh    # Seed sample data
npm run seed:admin --workspace=apps/api   # Seed admin user only
```

### Workspace-scoped package management

```bash
npm install some-package --workspace=apps/api
npm run test --workspace=apps/api
```

### VPS Deployment

```bash
bash installation/scripts/install_all.sh  # First-time VPS setup
bash installation/scripts/update_all.sh   # Deploy updates & restart services
bash installation/scripts/generate_env.sh # Generate root .env from template
```

## Architecture

### Services

| Service | Stack | Port | Description |
|---------|-------|------|-------------|
| `apps/api` | Node.js/Express/TypeScript | 3000 | REST API |
| `apps/admin` | React/Vite/TypeScript | 5174 (dev) / 8000 (prod) | Admin panel |
| `apps/mobile` | Expo/React Native | Expo | Buyer/seller mobile app |

Production ingress via Nginx Proxy Manager (Docker):
- `api.coziyoo.com` → `127.0.0.1:3000`
- `admin.coziyoo.com` → `127.0.0.1:8000`

### API Structure (`apps/api/src/`)

- `app.ts` — Express setup, middleware registration, route mounting
- `routes/` — 20 route files grouped by domain (`auth`, `orders`, `payments`, `livekit`, `admin/*`)
- `db/client.ts` — PostgreSQL pool (pg) using root `.env` vars
- `config/env.ts` — Zod-validated env schema; loads root `.env` plus `apps/api/.env`
- `services/` — Business logic layer (order state machine, payouts, outbox, Ollama, N8N, TTS, etc.)
- `db/client.ts` — PostgreSQL pool (pg) using root `.env` vars
- `db/migrations/` — Sequential SQL migrations (`0001_*.sql` → `0012_*.sql`)
- `middleware/` — Auth, CORS, content-type normalization, rate limiting, idempotency, RBAC

### Request Middleware Chain

Requests flow through: CORS → content-type normalization → request context (UUID) → auth → abuse protection → idempotency → route handler.

Content-type normalization strips malformed charset values before Express body parsing to prevent 415 errors from mobile clients.

### Authentication

- Two JWT realms: `app` (buyer/seller) and `admin` (admin panel)
- Separate secrets: `APP_JWT_SECRET` and `ADMIN_JWT_SECRET`
- Access + refresh token pairs; Bearer token in `Authorization` header
- Passwords hashed with Argon2

### Admin Panel (`apps/admin/src/`)

- `AppShell.tsx` — main layout with nav, global search, dark mode, language toggle
- `lib/api.ts` — `request()` wrapper: auto-refreshes JWT on 401, reads base URL from `VITE_API_BASE_URL`
- `lib/auth.ts` — token storage helpers
- `lib/i18n.ts` + `i18n/en.json` / `i18n/tr.json` — English and Turkish UI strings
- `pages/` — one file per admin page (Dashboard, Users, ReviewQueue, Compliance, Security, etc.)
- `components/ui.tsx` — shared UI primitives; `NotesPanel.tsx` — reusable notes sidebar

### Shared Packages

- `packages/shared-types` — TypeScript types shared across API, admin, mobile (`@coziyoo/shared-types`)
- `packages/shared-utils` — Utility functions (`@coziyoo/shared-utils`)

### Database Migrations

Migrations live in `apps/api/src/db/migrations/` as numbered SQL files. The `db-migrate.sh` script runs all pending migrations before service start in production. When adding a migration, use the next sequential number (currently up to `0012`).

### CI/CD

GitHub Actions (`.github/workflows/deploy-on-push.yml`) SSH-deploys to one or more VPS targets on push. Requires `DEPLOY_SSH_KEY` and `DEPLOY_TARGETS` secrets. Each target runs `update_all.sh` which pulls code, runs migrations, rebuilds, and restarts systemd services.

## Environment Configuration

Environment is split by app. Root `.env` is reserved for shared/ops values, while each app keeps its own runtime `.env`. Key groups:

- **API:** `PORT`, `APP_JWT_SECRET`, `ADMIN_JWT_SECRET`
- **Database:** `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `DATABASE_URL`
- **Admin:** `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Mobile:** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- **LiveKit:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- **S3:** `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_SELLER_DOCS`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (seller compliance document storage)
- **External:** `OLLAMA_BASE_URL`, `N8N_HOST`, `TTS_API_KEY`, `SPEECH_TO_TEXT_API_KEY`, `PAYMENT_WEBHOOK_SECRET`
- **CORS:** `CORS_ALLOWED_ORIGINS` (comma-separated list, supports `*` and `://*.domain` wildcards)

Installation-specific VPS settings (domains, OS passwords) go in `installation/config.env`.

## Error Response Format

All API errors use the shape:
```json
{ "error": { "code": "ERROR_CODE", "message": "Human-readable message" } }
```

HTTP 401 = unauthenticated, 403 = forbidden, 415 = unsupported content-type.

## Default Admin Credentials

After seeding: `admin@coziyoo.com` / `Admin12345`
