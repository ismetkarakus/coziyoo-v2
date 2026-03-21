# External Integrations

**Analysis Date:** 2026-03-21

## APIs & External Services

**Voice/Communication:**
- LiveKit - Real-time voice/video infrastructure
  - SDK/Client: `livekit-server-sdk` (2.15.0), `livekit-client` (2.9.4+), `@livekit/react-native` (2.9.6)
  - Auth: API key/secret in `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
  - Location: `apps/api/src/services/livekit.ts`, mobile implementation in `apps/mobile`
  - Purpose: Room creation, token generation, participant management

**AI/LLM:**
- Ollama - Local LLM inference
  - Service: `OLLAMA_BASE_URL` (default: http://127.0.0.1:11434)
  - Usage: Chat completions in `apps/api/src/services/ollama.ts`
  - Model: `OLLAMA_CHAT_MODEL` (default: llama3.1)
  - Timeout: `OLLAMA_TIMEOUT_MS` (30 seconds)

- OpenAI (via LiveKit Plugins) - LLM for voice agent
  - Plugin: `livekit-plugins-openai` (1.0.0+)
  - Location: `apps/voice-agent` entrypoint
  - Purpose: Chat completion in voice agent flows

**Speech Services:**
- Speech-to-Text (STT) - Audio transcription
  - Base URL: `SPEECH_TO_TEXT_BASE_URL` or `STT_BASE_URL`
  - API Key: `SPEECH_TO_TEXT_API_KEY`
  - Endpoint: `SPEECH_TO_TEXT_TRANSCRIBE_PATH` (default: /v1/audio/transcriptions)
  - Model: `SPEECH_TO_TEXT_MODEL` (default: whisper-1)
  - Max audio: 8MB
  - Timeout: 60 seconds
  - Used in: Voice agent audio processing

- Text-to-Speech (TTS) - Audio synthesis
  - Multiple engine support:
    - F5 TTS: `TTS_F5_BASE_URL` → `/api/tts` endpoint
    - XTTS: `TTS_XTTS_BASE_URL` → `/tts` endpoint (supports speaker clone via `TTS_XTTS_SPEAKER_WAV_URL`)
    - Chatterbox: `TTS_CHATTERBOX_BASE_URL` → `/tts` endpoint (predefined or clone voice modes)
  - Language: `TTS_LANGUAGE_DEFAULT` (tr for Turkish)
  - Timeout: 30 seconds
  - Used in: Voice agent speech output

**Workflow Automation:**
- N8N - Workflow engine
  - Base URL: `N8N_HOST`
  - API Key: `N8N_API_KEY`
  - Location: `apps/api/src/services/n8n.ts`
  - Workflows:
    - LLM workflow: ID `N8N_LLM_WORKFLOW_ID` (6KFFgjd26nF0kNCA default)
    - MCP workflow: ID `N8N_MCP_WORKFLOW_ID` (XYiIkxpa4PlnddQt default)
  - Webhooks: `N8N_LLM_WEBHOOK_URL`, `N8N_LLM_WEBHOOK_PATH`, `N8N_MCP_WEBHOOK_PATH`
  - Purpose: Order processing, end-of-call handlers

**AI Voice Agent Server:**
- Internal service at `AI_SERVER_URL` (default: http://127.0.0.1:9000)
- Shared secret: `AI_SERVER_SHARED_SECRET` (min 16 chars)
- Join endpoint: `AI_SERVER_LIVEKIT_JOIN_PATH` (/livekit/agent-session)
- Timeout: `AI_SERVER_TIMEOUT_MS` (10 seconds)
- Purpose: Mobile requests agent join via this bridge

## Data Storage

**Databases:**
- PostgreSQL (primary)
  - Connection string: `DATABASE_URL` or constructed from `PGHOST`, `PGUSER`, `PGDATABASE`, `PGPORT`, `PGPASSWORD`
  - Client: `pg` (8.18.0) with connection pooling
  - Location: `apps/api/src/db/client.ts`
  - Migrations: Sequential SQL in `apps/api/src/db/migrations/`
  - Typically: Supabase PostgreSQL instance

**File Storage:**
- Amazon S3 (conditional)
  - Endpoint: `S3_ENDPOINT` (optional - uses AWS default if omitted)
  - Region: `S3_REGION` (default: us-east-1)
  - Bucket: `S3_BUCKET_SELLER_DOCS`
  - Credentials: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
  - Configuration: `S3_FORCE_PATH_STYLE` (default: true)
  - Presigned URL TTL: 900 seconds
  - Location: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/compliance.ts`
  - Purpose: Seller compliance document storage and retrieval

**Client-Side Storage:**
- Mobile: AsyncStorage for tokens/user state (`@react-native-async-storage/async-storage` 1.23.1)
- Admin: Browser localStorage via `apps/admin/src/lib/auth.ts`
- Session state managed by LiveKit clients in browser/mobile

**Caching:**
- None detected - request caching handled via LiveKit client SDKs

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based (no third-party provider)

**Implementation:**
- Two JWT realms: `app` (buyer/seller) and `admin` (admin panel)
- Separate secrets: `APP_JWT_SECRET` (min 32 chars), `ADMIN_JWT_SECRET` (min 32 chars)
- Access + refresh token pairs:
  - Access token TTL: `ACCESS_TOKEN_TTL_MINUTES` (default: 15)
  - Refresh token TTL: `REFRESH_TOKEN_TTL_DAYS` (default: 30)
- Token generation: `apps/api/src/services/token-service.ts`
- Password hashing: Argon2 (argon2 0.44.0)
- Middleware: `apps/api/src/middleware/auth.ts` enforces Bearer token requirement
- Admin token refresh: `apps/admin/src/lib/api.ts` auto-refreshes on 401
- Idempotency: Request-level tokens in `apps/api/src/middleware/idempotency.ts` to prevent duplicate payments

## Payments

**Provider:**
- Name: `PAYMENT_PROVIDER_NAME` (default: mockpay for dev, swappable)
- Checkout Base URL: `PAYMENT_CHECKOUT_BASE_URL`
- Webhook Secret: `PAYMENT_WEBHOOK_SECRET` (for signature verification)

**Implementation:**
- Payment initiation: `apps/api/src/routes/payments.ts` → POST /start
- Return handling: Query param `result` (success/failed)
- Webhook ingestion: Validates signature with `PAYMENT_WEBHOOK_SECRET`
- Order state machine: Payment transitions in `apps/api/src/services/order-state-machine.ts`
- Outbox pattern: `apps/api/src/services/outbox.ts` for reliable payment events

## Monitoring & Observability

**Error Tracking:**
- Not detected

**Logs:**
- Console-based logging (stdout/stderr)
- Python voice agent: Rotating file handler to `/workspace/.runtime/voice-agent-worker-heartbeat.json`
- Request loggers in voice agent: llm_request_logger, n8n_request_logger, session_request_logger
- API error format: `{ error: { code, message } }` (standardized)

**Metrics:**
- Voice agent worker heartbeat: Path `/workspace/.runtime/voice-agent-worker-heartbeat.json`, interval 5 seconds

## CI/CD & Deployment

**Hosting:**
- VPS with systemd services (`coziyoo-api`, `coziyoo-admin`)
- Nginx Proxy Manager (Docker) for reverse proxy
- API ingress: `api.coziyoo.com` → 127.0.0.1:3000
- Admin ingress: `admin.coziyoo.com` → 127.0.0.1:8000

**CI Pipeline:**
- GitHub Actions: `.github/workflows/deploy-on-push.yml`
- Trigger: Push to main
- Action: SSH to `DEPLOY_TARGETS`, run `update_all.sh`
- Script steps: git pull, migrations, rebuild, systemd restart
- Secrets required: `DEPLOY_SSH_KEY`, `DEPLOY_TARGETS`

**Build Process:**
- API: `npm run build:api` → tsc compilation
- Admin: `npm run build:admin` → tsc + Vite build
- Mobile: Expo build via `npm run android` / `npm run ios`
- Voice Agent: `pip install -e .` from pyproject.toml

**Database Migrations:**
- Script: `bash installation/scripts/db-migrate.sh`
- Files: Sequential SQL in `apps/api/src/db/migrations/` (0001.sql → 0012.sql)
- Execution: Runs before service start in production

## Environment Configuration

**Required env vars (production):**
- `DATABASE_URL` or all of `PGHOST`, `PGUSER`, `PGDATABASE`
- `APP_JWT_SECRET` (min 32 chars)
- `ADMIN_JWT_SECRET` (min 32 chars)
- `PAYMENT_WEBHOOK_SECRET` (min 16 chars)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `AI_SERVER_SHARED_SECRET` (min 16 chars)

**Optional but recommended:**
- `OLLAMA_BASE_URL`, `OLLAMA_CHAT_MODEL`
- `SPEECH_TO_TEXT_BASE_URL`, `SPEECH_TO_TEXT_API_KEY`
- `TTS_F5_BASE_URL` or `TTS_XTTS_BASE_URL` or `TTS_CHATTERBOX_BASE_URL`
- `N8N_HOST`, `N8N_API_KEY`
- S3 credentials for seller compliance
- `VITE_API_BASE_URL` for admin frontend

**Secrets location:**
- Root `.env` file (not committed)
- Installation-specific VPS settings: `installation/config.env`
- Generated via: `bash installation/scripts/generate_env.sh`

## Webhooks & Callbacks

**Incoming (API receives):**
- Payment webhook: `PAYMENT_WEBHOOK_SECRET` signed POST to `/v1/payments/webhook`
  - Payload: `{ sessionId, providerReferenceId, result: "confirmed"|"failed" }`

**Outgoing (API sends):**
- N8N workflow webhooks: triggered on end-of-call
  - Endpoint: `N8N_LLM_WEBHOOK_URL` + `N8N_LLM_WEBHOOK_PATH`
  - Payload: Session end event from voice agent
- Voice agent events: sent to mobile via LiveKit data channel
  - Format: Deterministic JSON commands (UI actions)

## Tools & Plugins

**Tool Registry:**
- URL: `TOOLS_REGISTRY_URL` (https://registry.caal.io/index.json)
- Purpose: Dynamically load tools for voice agent

**LiveKit Plugins (Voice Agent):**
- Silero VAD: `livekit-plugins-silero` (1.2.6+)
- Turn Detection: `livekit-plugins-turn-detector` (1.4.5+)
- Noise Cancellation: `livekit-plugins-noise-cancellation` (0.2.5+)
- OpenAI: `livekit-plugins-openai` (1.0.0+)

## Compliance & Security

**Seller Document Verification:**
- S3 storage of compliance documents
- Presigned URLs for download (15 min expiry)
- Admin review queue: `apps/admin/src/pages/ReviewQueue.tsx`
- Status tracking: approved, rejected, pending in database

**Audit Logging:**
- Admin actions: `apps/api/src/services/admin-audit.ts`
- Location: Database table (model/change audit)

**Rate Limiting:**
- Implemented: `apps/api/src/middleware/abuse-protection.ts`
- Flows: payment_start (25/IP, 15/user per min), display_name_check (200/IP, 120/user per min), etc.
- Window: Configurable per route (default 60 seconds)

---

*Integration audit: 2026-03-21*
