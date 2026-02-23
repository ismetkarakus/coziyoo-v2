# Coolify Deployment (API + Admin Panel)

## 1) API service (`coziyoo-v2` root)

- Repository: `ismetkarakus/coziyoo-v2`
- Branch: `main`
- Base directory: repository root
- Install command: `npm ci`
- Build command: `npm run build`
- Start command: `npm run start`
- Health check path: `/v1/health`

### Required environment variables

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `APP_JWT_SECRET=...` (min 32 chars)
- `ADMIN_JWT_SECRET=...` (min 32 chars)
- `PAYMENT_WEBHOOK_SECRET=...` (min 16 chars)
- `CORS_ALLOWED_ORIGINS=https://admin.example.com`

Database can be configured in either format:

1. Single URL:
- `DATABASE_URL=postgresql://user:pass@host:5432/db`

2. Split PG variables:
- `PGHOST=...`
- `PGPORT=5432`
- `PGUSER=...`
- `PGPASSWORD=...`
- `PGDATABASE=...`

Optional DB SSL behavior:
- `DATABASE_SSL_MODE=auto` (default)
- `DATABASE_SSL_MODE=disable`
- `DATABASE_SSL_MODE=require`
- `DATABASE_SSL_MODE=no-verify`

## 2) Admin panel service (`admin-panel`)

- Repository: `ismetkarakus/coziyoo-v2`
- Branch: `main`
- Base directory: `admin-panel`
- Install command: `npm ci`
- Build command: `npm run build`
- Publish/output directory: `dist`

### Required environment variables
- `VITE_API_BASE_URL=https://api.example.com`

## 3) First-time DB initialization

Run once against a fresh database:

`npm run db:init:empty`

This command refuses to run on non-empty DB unless:

`FORCE_DB_INIT=true npm run db:init:empty`

Create/update initial admin user:

`SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='StrongPass123!' npm run seed:admin`
