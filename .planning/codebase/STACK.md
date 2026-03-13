# Technology Stack

**Analysis Date:** 2026-03-12

## Languages

**Primary:**
- TypeScript 5.9.3 - Used across API (`apps/api`), admin panel (`apps/admin`), mobile (`apps/mobile`), and shared packages
- JavaScript/Node.js - Runtime for API and admin services
- Python 3.12+ - Voice agent implementation (`apps/voice-agent`)
- React Native/JSX - Mobile UI (`apps/mobile`)

**Secondary:**
- SQL - Database migrations and queries (`apps/api/src/db/migrations/`)

## Runtime

**Environment:**
- Node.js 20.0.0+ (specified in root `package.json`)
- Python 3.11+ (specified in `apps/voice-agent/pyproject.toml`)
- Docker containers for production deployment (Postgres 16, Node 20-bookworm, Python 3.12-bookworm)

**Package Manager:**
- npm v8+ (npm workspaces for monorepo management)
- Lockfile: `package-lock.json` (present in root)
- Python: pip with virtual environment (`.venv` for voice-agent)

## Frameworks

**Core:**
- Express 5.2.1 - REST API framework (`apps/api`)
- React 18.3.1 - Admin UI framework (`apps/admin`)
- React Native 0.76.9 - Mobile app framework (`apps/mobile`)
- Expo ~52.0.46 - Mobile development platform (`apps/mobile`)
- FastAPI 0.115.0+ - Voice agent join API (`apps/voice-agent/src/voice_agent/join_api.py`)

**Testing:**
- Vitest 4.0.18 - Unit test runner for API (`apps/api`)
- TypeScript compiler (`tsc`) - Type checking for mobile (`apps/mobile`)

**Build/Dev:**
- Vite 5.4.21 - Admin panel bundler and dev server (`apps/admin`)
- TypeScript 5.9.3 - Compiler (`tsc`)
- tsx 4.21.0 - TypeScript execution for API development (`apps/api`)
- Babel 7.24.0+ - Mobile transpilation (`apps/mobile`)

## Key Dependencies

**Critical:**
- `pg` 8.18.0 - PostgreSQL driver for Node.js (`apps/api`)
- `jsonwebtoken` 9.0.3 - JWT token generation and validation (`apps/api`)
- `argon2` 0.44.0 - Password hashing (`apps/api`)
- `livekit-server-sdk` 2.15.0 - LiveKit room/token management API (`apps/api/src/services/livekit.ts`)
- `livekit-client` 2.17.2 (admin), 2.9.4 (mobile) - LiveKit WebRTC client
- `@livekit/react-native` 2.9.6, `@livekit/react-native-webrtc` 137.0.2 - LiveKit mobile bindings

**Infrastructure:**
- `dotenv` 17.3.1 - Environment variable loading (`apps/api`)
- `zod` 4.3.6 - Schema validation (API, admin)
- `react-router-dom` 6.30.1 - Client-side routing (`apps/admin`)
- `pydantic` 2.10.6+ - Schema validation for Python (`apps/voice-agent`)
- `aiohttp` 3.10.0+ - Async HTTP client for Python (`apps/voice-agent/src/voice_agent/providers/`)
- `uvicorn` 0.34.0+ - ASGI server for voice agent join API (`apps/voice-agent`)
- `python-dotenv` 1.0.1+ - Environment variable loading for Python (`apps/voice-agent`)

**Voice Agent Plugins:**
- `livekit-agents` 1.2.6+ - LiveKit agent framework
- `livekit-plugins-silero` 1.2.6 - Silero VAD (voice activity detection)
- `livekit-plugins-turn-detector` 1.4.5 - Multi-lingual turn detection
- `livekit-plugins-noise-cancellation` 0.2.5 - Noise filtering
- `livekit-plugins-openai` 1.0.0 - OpenAI integration (stub for TTS/STT)

## Configuration

**Environment:**
- Root `.env` is single source of truth for all services
- Services read directly: `apps/api` via `dotenv`, Python services via `python-dotenv`
- Config structure: `apps/api/src/config/env.ts` uses Zod for validation and type safety
- TypeScript compilation: `apps/api/tsconfig.json` targets ES2022, NodeNext modules, strict mode enabled

**Build:**
- `apps/api/tsconfig.json` - Compiles `src/` to `dist/` (ES2022 target)
- `apps/admin/vite.config.ts` - Dev server on port 5174, proxies `/v1` to API
- `apps/mobile/package.json` - Expo managed workflow
- `apps/voice-agent/pyproject.toml` - Standard setuptools configuration with entry point

## Platform Requirements

**Development:**
- Git repository
- Docker and Docker Compose for local stack orchestration
- Node.js 20+, Python 3.12+ (or use Docker)
- PostgreSQL 16 (via Docker recommended)
- npm workspaces support

**Production:**
- Ubuntu/Debian Linux VPS
- systemd for service management (systemd units: `coziyoo-api`, `coziyoo-admin`, `coziyoo-voice-agent`)
- Docker + Docker Compose for Postgres and Nginx Proxy Manager
- Python 3.12 with pip
- Node.js 20+
- Nginx Proxy Manager in Docker for ingress (`api.coziyoo.com`, `admin.coziyoo.com`)

---

*Stack analysis: 2026-03-12*
