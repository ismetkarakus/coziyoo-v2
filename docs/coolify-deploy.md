# Coolify Deployment (API + Admin Panel)

## 1) API service (`coziyoo-v2` root)

- Repository: `ismetkarakus/coziyoo-v2`
- Branch: `main`
- Base directory: repository root
- Install command: `npm ci`
- Build command: `npm run build`
- Start command: `npm run start:migrate`
- Health check path: `/v1/health`

### Required environment variables

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3000`
- `JSON_BODY_LIMIT=15mb`
- `APP_JWT_SECRET=...` (min 32 chars)
- `ADMIN_JWT_SECRET=...` (min 32 chars)
- `PAYMENT_WEBHOOK_SECRET=...` (min 16 chars)
- `CORS_ALLOWED_ORIGINS=https://admin.example.com`
  - Supports comma-separated wildcard entries for subdomains, e.g. `https://*.example.com`

LiveKit integration (external server on Coolify):

- `LIVEKIT_URL=wss://livekit.example.com` (your deployed LiveKit websocket URL)
- `LIVEKIT_API_KEY=...`
- `LIVEKIT_API_SECRET=...`
- `AI_SERVER_SHARED_SECRET=...` (min 16 chars, used by AI server to request agent token)
- `AI_SERVER_URL=https://ai.example.com` (optional, required if admin panel will dispatch token directly to AI server)

Optional:

- `LIVEKIT_TOKEN_TTL_SECONDS=3600`
- `LIVEKIT_AGENT_IDENTITY=coziyoo-ai-agent`
- `AI_SERVER_LIVEKIT_JOIN_PATH=/livekit/agent-session`
- `AI_SERVER_TIMEOUT_MS=10000`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_CHAT_MODEL=llama3.1`
- `OLLAMA_TIMEOUT_MS=30000`
- `OLLAMA_SYSTEM_PROMPT=You are Coziyoo AI assistant. Be concise and helpful.`

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

## 2b) Agent Frontend (`agent`)

- Repository: `ismetkarakus/coziyoo-v2`
- Branch: `main`
- Base directory: `agent`
- Install command: `pnpm install`
- Build command: `npm run build`
- Start command: `pnpm start` (or `pnpm dev` for development)

### Required environment variables

- `API_BASE_URL=https://api.example.com`
- Optional: `NEXT_PUBLIC_API_BASE_URL=https://api.example.com`

## 5) LiveKit token endpoints

These endpoints do not run LiveKit; they mint tokens for your existing LiveKit server:

- `POST /v1/livekit/token`
  - Auth: App bearer token (`Authorization: Bearer ...`)
  - Use from mobile/web app to join room as user
- `POST /v1/livekit/agent-token`
  - Auth: `x-ai-server-secret: <AI_SERVER_SHARED_SECRET>`
  - Use from AI server to join room as agent

Admin-only LiveKit control endpoints:

- `GET /v1/admin/livekit/status`
- `POST /v1/admin/livekit/token/user`
- `POST /v1/admin/livekit/token/agent`
- `POST /v1/admin/livekit/dispatch/agent` (mints token and forwards it to `AI_SERVER_URL + AI_SERVER_LIVEKIT_JOIN_PATH`)
- `POST /v1/admin/livekit/session/start` (creates room + user token + agent token + dispatches agent)
- `POST /v1/admin/livekit/agent/chat` (sends text to Ollama `/api/chat`, publishes agent response to room data channel)

App endpoint:

- `POST /v1/livekit/session/start` (auth required, creates room + user token + agent token + dispatches agent)
- `POST /v1/livekit/agent/chat` (auth required, sends text to Ollama `/api/chat`, publishes agent response to room data channel)

## 6) Assistant Speech Runtime

Speech I/O is handled by the AI server/assistant runtime:
- user mic audio is consumed from LiveKit
- assistant executes STT + LLM + TTS
- assistant publishes audio track directly to LiveKit

API STT/TTS runtime endpoints have been removed from this repo.
Configure speech providers in assistant runtime `config.json` (global), not in API runtime routes.

## 3) Database migrations

Automatic migration on every API restart/deploy:

- `npm run start:migrate` runs `npm run db:migrate` before starting API.
- Migration files are in `src/db/migrations/*.sql`.
- Applied migrations are tracked in `schema_migrations`.

If you attach API to an existing database that already has tables but no migration history, set this once:

- `DB_MIGRATE_BASELINE=0001_initial_schema`

Then remove it after first successful deploy.

## 4) First-time DB initialization (optional alternative)

Run once against a fresh database:

`npm run db:init:empty`

This command refuses to run on non-empty DB unless:

`FORCE_DB_INIT=true npm run db:init:empty`

Create/update initial admin user:

`SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='StrongPass123!' npm run seed:admin`
