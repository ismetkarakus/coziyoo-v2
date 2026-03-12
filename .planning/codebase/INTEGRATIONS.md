# External Integrations

**Analysis Date:** 2026-03-12

## APIs & External Services

**N8N (Workflow Automation):**
- Service: N8N workflow orchestration engine
- What it's used for: Workflow automation, including LLM tool invocation, MCP (Model Context Protocol) execution, user memory read/write, order processing triggers
- SDK/Client: HTTP REST API via native `fetch` (Node.js)
- Config env vars: `N8N_HOST` (required), `N8N_API_KEY` (optional)
- Workflow IDs: `N8N_LLM_WORKFLOW_ID` (default: `6KFFgjd26nF0kNCA`), `N8N_MCP_WORKFLOW_ID` (default: `XYiIkxpa4PlnddQt`)
- Implementation: `apps/api/src/services/n8n.ts` - checks health, runs workflows via webhook, sends session end events
- Timeouts: HTTP request verification (no explicit timeout configured)
- Health check: `/healthz` endpoint with workflow accessibility verification

**Ollama (Local LLM):**
- Service: Local large language model serving via HTTP
- What it's used for: Chat completions, system prompt formatting, multi-turn conversations
- SDK/Client: HTTP REST API via native `fetch`
- Config env vars: `OLLAMA_BASE_URL` (default: `http://127.0.0.1:11434`), `OLLAMA_CHAT_MODEL` (default: `llama3.1`), `OLLAMA_SYSTEM_PROMPT`
- Implementation: `apps/api/src/services/ollama.ts` - streaming chat completions
- Timeout: `OLLAMA_TIMEOUT_MS` (default: 30,000ms, max: 120,000ms)
- Used by: Admin settings panel for model configuration and list fetching

**Speech-to-Text (STT):**
- Service: External transcription API (e.g., OpenAI Whisper API compatible)
- What it's used for: Converting audio input to text in voice agent
- SDK/Client: HTTP REST (aiohttp in Python)
- Config env vars: `SPEECH_TO_TEXT_BASE_URL` or `STT_BASE_URL`, `SPEECH_TO_TEXT_API_KEY`, `SPEECH_TO_TEXT_MODEL` (default: `whisper-1`)
- Endpoint path: `SPEECH_TO_TEXT_TRANSCRIBE_PATH` (default: `/v1/audio/transcriptions`)
- Implementation: `apps/voice-agent/src/voice_agent/providers/http_stt.py` - streaming transcription with aiohttp
- Timeout: `SPEECH_TO_TEXT_TIMEOUT_MS` (default: 60,000ms, max: 120,000ms)
- Max audio size: `SPEECH_TO_TEXT_MAX_AUDIO_BYTES` (default: 8MB, max: 25MB)

**Text-to-Speech (TTS):**
- Services: Multiple TTS providers supported
  - F5 TTS: `TTS_F5_BASE_URL`, synth path: `TTS_F5_SYNTH_PATH` (default: `/api/tts`)
  - XTTS: `TTS_XTTS_BASE_URL`, synth path: `TTS_XTTS_SYNTH_PATH` (default: `/tts`)
  - Chatterbox: `TTS_CHATTERBOX_BASE_URL`, synth path: `TTS_CHATTERBOX_SYNTH_PATH` (default: `/tts`)
- SDK/Client: HTTP REST (aiohttp in Python)
- Config env vars:
  - Common: `TTS_LANGUAGE_DEFAULT` (default: `tr`), `TTS_API_KEY`, `TTS_SPEAKER_ID` (default: `default`)
  - Chatterbox specific: `TTS_CHATTERBOX_VOICE_MODE` (predefined|clone), `TTS_CHATTERBOX_PREDEFINED_VOICE_ID`, `TTS_CHATTERBOX_REFERENCE_AUDIO_FILENAME`, `TTS_CHATTERBOX_OUTPUT_FORMAT` (wav|opus), various quality params (temperature, exaggeration, CFG weight, etc.)
- Implementation: `apps/voice-agent/src/voice_agent/providers/http_tts.py` - streaming synthesis with aiohttp
- Timeout: `TTS_TIMEOUT_MS` (default: 30,000ms, max: 120,000ms)

**LiveKit (Real-Time Communication):**
- Service: WebRTC rooms, participant management, data channel for UI actions
- What it's used for: Voice/video sessions between mobile users and AI agents
- SDK/Client: `livekit-server-sdk` 2.15.0 (Node.js), `livekit-client` 2.17.2/2.9.4 (browser/mobile), `livekit-agents` 1.2.6+ (Python agent)
- Config env vars: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Token TTL: `LIVEKIT_TOKEN_TTL_SECONDS` (default: 3600s, max: 86400s)
- Agent identity: `LIVEKIT_AGENT_IDENTITY` (default: `coziyoo-ai-agent`, max: 128 chars)
- Implementation:
  - `apps/api/src/services/livekit.ts` - Token generation, room creation, data channel messaging, metadata handling
  - `apps/voice-agent/src/voice_agent/entrypoint.py` - Agent session dispatch, job context handling
  - `apps/mobile/src/screens/VoiceSessionScreen.tsx` - WebRTC connection and state management
  - `apps/admin` - Monitor live sessions via `livekit-client`
- Room lifecycle: Created on demand, persists for session duration, cleaned up after session end
- Data channel: Send UI action commands to mobile client (deterministic JSON)

**Payment Provider (Abstracted):**
- Service: Configurable payment processor
- What it's used for: Order payment processing with webhook callbacks
- Provider name: `PAYMENT_PROVIDER_NAME` (default: `mockpay` - mock/testing mode)
- Webhook verification: HMAC-SHA256 signature validation using `PAYMENT_WEBHOOK_SECRET`
- Checkout URL: `PAYMENT_CHECKOUT_BASE_URL` (default: `https://checkout.example.com/session`)
- Implementation: `apps/api/src/routes/payments.ts` - Session creation, webhook handling, order state transitions
- Supports: Mock provider for development, real provider integration via env config

## Data Storage

**Databases:**
- PostgreSQL 16 (primary)
  - Connection: Via `DATABASE_URL` or individual vars (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`)
  - Client: `pg` 8.18.0 (Node pool-based)
  - SSL Mode: `DATABASE_SSL_MODE` (auto|disable|require|no-verify, default: auto)
  - Migrations: Located in `apps/api/src/db/migrations/` (0001-0013 sequential SQL files)
  - Connection: `apps/api/src/db/client.ts` - Pool with idle error handling
  - Query runs via `pool.query()` throughout `apps/api/src/`

**File Storage:**
- Local filesystem only (images, audio, etc. stored in Docker volumes or VPS directories)
- No S3 or external blob storage configured

**Caching:**
- None (no Redis, Memcached, or similar configured)

## Authentication & Identity

**Auth Provider:**
- Custom JWT implementation
- Two realms: `app` (buyers/sellers) and `admin` (admin panel)
- JWT Secrets: `APP_JWT_SECRET` and `ADMIN_JWT_SECRET` (min 32 chars each)
- Token pair: Access token + refresh token
- Access token TTL: `ACCESS_TOKEN_TTL_MINUTES` (default: 15)
- Refresh token TTL: `REFRESH_TOKEN_TTL_DAYS` (default: 30)
- Password hashing: Argon2 via `argon2` 0.44.0 package
- Implementation: `apps/api/src/middleware/auth.ts` - Bearer token extraction and validation
- Middleware chain: CORS → content-type normalization → request context → auth → abuse protection → idempotency → handler

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry, Rollbar, or similar)

**Logs:**
- Console/stdout logging in Node.js services
- Rotating file logs in Python voice agent: `VOICE_AGENT_REQUEST_LOG_FILE` (default: `/workspace/.runtime/voice-agent-requests.log`)
- Structured JSON request logs for STT, TTS, LLM, N8N (via `logging` module)
- Health endpoint: `/v1/health` - Database connectivity check with response time

## CI/CD & Deployment

**Hosting:**
- VPS (likely Ubuntu/Debian)
- Systemd service management for API, admin, voice-agent services
- Docker containers for Postgres and Nginx Proxy Manager

**CI Pipeline:**
- GitHub Actions: `.github/workflows/deploy-on-push.yml`
- Trigger: Push to main/codex branch
- Deployment: SSH to VPS, run `update_all.sh` (migrations, rebuilds, restarts services)
- Secrets required: `DEPLOY_SSH_KEY`, `DEPLOY_TARGETS` (comma-separated VPS addresses)

**Deployment Scripts:**
- `installation/scripts/install_all.sh` - First-time VPS setup
- `installation/scripts/update_all.sh` - Rolling updates (git pull, migrations, rebuild, restart)
- `installation/scripts/db-migrate.sh` - Run pending migrations (idempotent)
- `installation/scripts/install_api_service.sh` - Systemd service for API
- `installation/scripts/install_voice_agent_service.sh` - Systemd service for voice agent

## Environment Configuration

**Required env vars (critical):**
- `APP_JWT_SECRET` - Min 32 chars
- `ADMIN_JWT_SECRET` - Min 32 chars
- `PAYMENT_WEBHOOK_SECRET` - Min 16 chars
- `PGHOST`, `PGUSER`, `PGDATABASE` (or `DATABASE_URL`)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (for voice features)

**Optional but recommended:**
- `N8N_HOST` - Workflow engine base URL
- `OLLAMA_BASE_URL` - LLM server
- `SPEECH_TO_TEXT_BASE_URL`, `SPEECH_TO_TEXT_API_KEY` - STT provider
- `TTS_*_BASE_URL`, `TTS_API_KEY` - TTS provider

**Secrets location:**
- Root `.env` file (single source of truth for all services)
- Installation-specific settings: `installation/config.env` (for VPS domain, OS passwords, etc.)
- **Important:** `.env` and `.env.local` are git-ignored (never committed)

## Webhooks & Callbacks

**Incoming Webhooks:**
- Payment webhook: `POST /v1/payments/webhook` - Receives payment provider callbacks with HMAC signature validation
- N8N workflow webhooks: Called by N8N workflows with session end events and order processing triggers

**Outgoing Webhooks:**
- N8N calls to order processing workflows: Triggered on session end via `apps/api/src/services/n8n.ts`
- Session end event format: Room name, participant identity, summary, outcome, metadata sent to N8N

## Version Constraints

**Locked versions:**
- All critical dependencies pinned to specific versions in `package.json`/`pyproject.toml`
- npm workspaces: Single root `package.json` with workspace dependencies
- Shared packages: `@coziyoo/shared-types`, `@coziyoo/shared-utils` (internal npm packages)

---

*Integration audit: 2026-03-12*
