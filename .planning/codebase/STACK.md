# Technology Stack

**Analysis Date:** 2026-03-21

## Languages

**Primary:**
- TypeScript 5.9.3 - API (`apps/api`), Admin panel (`apps/admin`), Mobile (`apps/mobile`)
- JavaScript (Module/ESM) - Runtime execution across all services
- Python 3.11+ - Voice agent (`apps/voice-agent`)

**Package Format:**
- npm workspaces monorepo with TypeScript source

## Runtime

**Environment:**
- Node.js >= 20.0.0 (core requirement in `package.json`)
- Python 3.11+ for voice agent

**Package Manager:**
- npm with workspace support
- Lockfile: `package-lock.json` present
- pip for Python voice agent dependencies

## Frameworks

**Backend (Node.js):**
- Express 5.2.1 - REST API server in `apps/api/src/server.ts`
- pg 8.18.0 - PostgreSQL client for database operations

**Frontend:**
- React 18.3.1 - Admin panel (`apps/admin/src`) and Mobile (`apps/mobile`)
- React Router DOM 6.30.1 - Admin panel routing in `apps/admin/src`
- Vite 5.4.21 - Admin build tool and dev server (port 5174)
- Expo ~52.0.46 - Mobile framework (`apps/mobile`) with React Native 0.76.9

**Voice Agent (Python):**
- FastAPI >= 0.115.0 - Join API endpoint in `apps/voice-agent/src/voice_agent/join_api.py`
- Uvicorn >= 0.34.0 - ASGI server for FastAPI (port 9000)
- LiveKit Agents >= 1.2.6 - Agent runtime in `apps/voice-agent/src/voice_agent/entrypoint.py`

**Testing:**
- Vitest 4.0.18 - Unit tests in `apps/api` (command: `npm run test:api`)
- TypeScript typecheck in mobile (`npm run build`)

## Key Dependencies

**Critical (Backend/API):**
- jsonwebtoken 9.0.3 - JWT signing/verification for two realms: `app` and `admin`
- argon2 0.44.0 - Password hashing (Argon2id)
- zod 4.3.6 - Runtime type validation for environment and request schemas
- livekit-server-sdk 2.15.0 - Room management, token generation in `apps/api/src/services/livekit.ts`

**AWS/Storage:**
- @aws-sdk/client-s3 3.1009.0 - S3 operations in `apps/api/src/routes/auth.ts` and `compliance.ts`
- @aws-sdk/s3-request-presigner 3.1009.0 - Presigned URL generation for seller compliance documents

**Voice/Media (Python):**
- livekit-plugins-silero >= 1.2.6 - Voice Activity Detection (VAD)
- livekit-plugins-openai >= 1.0.0 - OpenAI integration for LLM
- livekit-plugins-noise-cancellation >= 0.2.5 - Audio preprocessing
- livekit-plugins-turn-detector >= 1.4.5 - Speech turn detection
- pydantic >= 2.10.6 - Data validation in Python agent

**Frontend:**
- livekit-client 2.9.4+ - WebRTC client in admin/mobile
- @livekit/react-native 2.9.6 - React Native binding in mobile
- @livekit/react-native-webrtc 137.0.2 - WebRTC support for mobile
- @react-native-async-storage/async-storage 1.23.1 - Local storage in mobile

## Build Configuration

**TypeScript Compilation:**
- API: `tsc -p tsconfig.json` (target: ES2022, module: NodeNext)
- Admin: `tsc -b` with project references + Vite build
- Mobile: Type checking only via `tsc --noEmit`
- Output: `dist/src/` for API, `dist/` for admin

**Vite Config (Admin):**
- Dev server: http://localhost:5174
- Build output: dist/ (default)
- React plugin for JSX
- Proxy to API: `/v1` routes forward to http://localhost:3000
- Cache directory: `.vite/`

**Development Entry Points:**
- API: `apps/api/src/server.ts` (started via `tsx watch src/server.ts`)
- Admin: `apps/admin/src/main.tsx` (Vite default)
- Mobile: `apps/mobile/index.js` (Expo)
- Voice Agent: `apps/voice-agent/src/voice_agent/entrypoint.py`

## Configuration

**Environment Variables:**
- Single source of truth: root `.env` file
- Validation: Zod schema in `apps/api/src/config/env.ts`
- Fallback: Loads `.env.local` first, then `.env`
- Admin panel reads `VITE_API_BASE_URL` from environment for API endpoint

**Key Configuration Groups:**
- **Core:** `NODE_ENV`, `HOST`, `PORT`, `CORS_ALLOWED_ORIGINS`, `JSON_BODY_LIMIT`
- **Auth:** `APP_JWT_SECRET`, `ADMIN_JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, token TTLs
- **Database:** `DATABASE_URL` or individual `PGHOST`/`PGUSER`/`PGDATABASE`/`PGPORT`/`PGPASSWORD`, `DATABASE_SSL_MODE`
- **Payments:** `PAYMENT_PROVIDER_NAME`, `PAYMENT_CHECKOUT_BASE_URL`
- **LiveKit:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, token/room settings
- **AI Server:** `AI_SERVER_URL`, `AI_SERVER_SHARED_SECRET`, timeout
- **Ollama:** `OLLAMA_BASE_URL`, `OLLAMA_CHAT_MODEL`, timeout, system prompt
- **Speech-to-Text:** `SPEECH_TO_TEXT_BASE_URL` or `STT_BASE_URL`, model, API key, timeout
- **Text-to-Speech:** Multiple engine URLs (F5, XTTS, Chatterbox) with synthesis paths and voice settings
- **N8N:** `N8N_HOST`, `N8N_API_KEY`, workflow IDs for LLM and MCP
- **S3:** Conditionally configured with `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_SELLER_DOCS`, credentials
- **Tools:** `TOOLS_REGISTRY_URL` pointing to CAAL registry

## Database

**Primary:** PostgreSQL (via `pg` driver)
- Connection pooling: enabled
- SSL mode: Auto-detection (localhost = disabled, remote = required with reject=false)
- Migrations: Sequential SQL files in `apps/api/src/db/migrations/` (0001-0012)
- Query interface: `pool` from `apps/api/src/db/client.ts`

## Platform Requirements

**Development:**
- Node.js >= 20.0.0
- PostgreSQL 12+ (local or remote)
- Python 3.11+ for voice agent
- Recommended: Docker for LiveKit, Ollama, N8N, STT/TTS services

**Production:**
- VPS deployment via systemd services: `coziyoo-api`, `coziyoo-admin`
- Nginx Proxy Manager (Docker) for reverse proxy
- PostgreSQL managed database (Supabase compatible)
- Optional: LiveKit cloud, N8N cloud, or self-hosted AI services

## Performance Characteristics

**API Response Limits:**
- JSON body limit: 15MB (configurable)
- Speech-to-Text max audio: 8MB (configurable)
- S3 presigned URLs valid for 15 minutes (900 seconds)

**Timeouts:**
- AI Server: 10 seconds (configurable)
- Ollama: 30 seconds (configurable)
- Speech-to-Text: 60 seconds (configurable)
- Text-to-Speech: 30 seconds (configurable)
- LiveKit token TTL: 3600 seconds

---

*Stack analysis: 2026-03-21*
