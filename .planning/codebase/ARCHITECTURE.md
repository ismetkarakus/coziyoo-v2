# Architecture

**Analysis Date:** 2026-03-21

## Pattern Overview

**Overall:** Monorepo with layered API, multi-workspace setup with clear separation between mobile, admin, and backend services. Event-driven order processing with state machine enforcement.

**Key Characteristics:**
- Multiple services with distinct responsibilities: REST API, admin panel, mobile app, Python voice agent
- Request middleware pipeline with auth realms (app vs admin), abuse protection, idempotency
- Transaction-based order state machine with side effects queued to outbox
- Bearer token auth with dual JWT realms and separate secrets
- Database-driven configuration sourced from single root `.env`

## Layers

**Presentation (Client Layer):**
- Purpose: User-facing applications
- Location: `apps/admin/src/` (React/Vite), `apps/mobile/src/` (Expo/React Native), `apps/voice-agent/src/` (Python FastAPI join API)
- Contains: Page components, screens, UI primitives, route definitions
- Depends on: API clients to call backend services
- Used by: End users (admins, buyers, sellers, voice callers)

**API Layer (Request Handling):**
- Purpose: Route definition, parameter validation, request orchestration
- Location: `apps/api/src/routes/`
- Contains: 20+ route files grouped by domain (auth, orders, payments, admin/*, compliance, etc.)
- Depends on: Services layer, database client, middleware chain
- Used by: Admin panel, mobile app, voice agent via HTTP calls

**Middleware Chain:**
- Purpose: Cross-cutting concerns applied before route handlers
- Location: `apps/api/src/middleware/`
- Contains: Auth (requireAuth), role resolution (app-role), abuse protection, request context (observability), idempotency, RBAC (admin-rbac)
- Order: CORS → content-type normalization → request context → auth → abuse protection → idempotency → route handler
- Depends on: Token service, auth utils
- Key middleware files: `auth.ts` (JWT verification), `app-role.ts` (actor role resolution), `admin-rbac.ts` (admin role checks)

**Business Logic (Services Layer):**
- Purpose: Stateless business logic, domain-specific operations
- Location: `apps/api/src/services/`
- Contains: Order state machine, payout scheduler, finance calculations, token generation, LiveKit integration, Ollama LLM, N8N webhooks, outbox pattern
- Key services:
  - `order-state-machine.ts` — Transition rules, actor permissions, terminal status checks
  - `outbox.ts` — Transactional event queueing for async processing
  - `token-service.ts` — JWT generation/verification for both realms
  - `finance.ts` — Order finalization, payout calculations
  - `payout-scheduler.ts` — Scheduled payout processing
  - `livekit.ts` — Token generation for voice sessions
  - `ollama.ts` — LLM integration
  - `n8n.ts` — N8N workflow webhook firing
- Depends on: Database client
- Used by: Route handlers, scheduled jobs

**Data Access (Database Layer):**
- Purpose: Database connectivity and query execution
- Location: `apps/api/src/db/client.ts`
- Contains: PostgreSQL pool (pg driver), connection management, SSL configuration
- Key exports:
  - `pool` — Connection pool singleton
  - `createDbClient()` — Returns pool instance
  - `pingDatabase()` — Health check query
- Depends on: Environment config for connection string
- Used by: Services, routes (directly via pool.connect() for transactions)

**Configuration Layer:**
- Purpose: Environment validation and schema definition
- Location: `apps/api/src/config/env.ts`
- Contains: Zod-validated schema for all env vars; loads `.env.local` then `.env`
- Key exports: `env` object with validated secrets, URLs, ports, limits
- Depends on: Root `.env` file
- Used by: Every other layer at runtime

**Shared Packages:**
- Purpose: Types and utilities shared across workspaces
- Location: `packages/shared-types/src/`, `packages/shared-utils/src/`
- Contains: Common TypeScript types, validation helpers
- Used by: API, admin panel, mobile app

## Data Flow

**Order Creation Flow:**

1. Client (mobile/voice) calls `POST /v1/orders` with sellerId, items, delivery details
2. Middleware chain processes: auth (JWT validation) → role check (must be buyer) → abuse protection → idempotency
3. Route handler validates schema with Zod
4. Handler acquires database client and begins transaction
5. Queries for lot availability, reserves quantities, calculates pricing
6. Creates order record in database
7. Calls `finalizeOrderFinanceTx()` to record financial impacts (buyer balance, seller payouts)
8. Enqueues outbox event: `{ eventType: "order_created", aggregateType: "order", aggregateId: orderId, payload }`
9. Commits transaction; returns order object to client
10. Background processor reads outbox events and fires N8N webhook for async order processing

**Order Status Update Flow:**

1. Client calls `PATCH /v1/orders/{orderId}` with new status
2. Handler validates state machine transition: `canTransition(currentStatus, newStatus)`
3. Handler checks actor permissions: `canActorSetStatus(actorRole, newStatus)`
4. If valid: updates status in database
5. If terminal status (completed/rejected/cancelled): finalizes finances, enqueues terminal event
6. Returns updated order

**Voice Agent Session Flow:**

1. Mobile calls `POST /v1/livekit/join` to request agent
2. Handler generates LiveKit token signed with LIVEKIT_API_SECRET
3. Returns token + room name; mobile connects to LiveKit room
4. Python voice agent (apps/voice-agent) connects as worker
5. Agent receives audio stream via Silero VAD
6. Sends audio to STT provider (HTTP-based)
7. Sends transcript to Ollama LLM
8. LLM can invoke tools (sales_tools.py) to trigger UI actions on mobile
9. Sends audio response via TTS provider
10. Agent closes session; fires N8N webhook to process order if created

**State Management:**

- Order state: Managed by PostgreSQL, validated by state machine before transitions
- Auth state: JWT tokens (short-lived access, longer-lived refresh)
- App config state: Environment variables loaded at startup
- Financial state: Recorded in orders, payments, payout tables; calculated via service functions
- Outbox events: Persisted in database until processed; event source for async workflows

## Key Abstractions

**OrderStatus State Machine:**
- Purpose: Enforce valid order status transitions and role-based permissions
- Examples: `apps/api/src/services/order-state-machine.ts`
- Pattern: TypeScript discriminated union (type OrderStatus) + lookup tables (transitions Record)
- Exports: `canTransition()`, `canActorSetStatus()`, `isTerminalStatus()`

**AuthRealm:**
- Purpose: Separate JWT token spaces for app (buyers/sellers) vs admin (admin panel)
- Examples: Used in `apps/api/src/middleware/auth.ts`, `apps/api/src/services/token-service.ts`
- Pattern: `"app" | "admin"` string literal; verified at token decode time
- Benefit: Prevents token scope creep; admin tokens cannot access buyer/seller endpoints

**Transactional Outbox Pattern:**
- Purpose: Guarantee order event delivery despite async processing failures
- Examples: `apps/api/src/services/outbox.ts`, order routes enqueue on transaction commit
- Pattern: Insert event record atomically with business data in same transaction; background job polls and processes
- Benefit: Events never lost; provides eventual consistency for N8N webhooks

**Request Context:**
- Purpose: Track requests through system for observability
- Examples: `apps/api/src/middleware/observability.ts`
- Pattern: Generate UUID per request, attach to req.requestId, include in response header and JSON logging
- Benefit: Correlate logs across API, database, external services

**Admin RBAC:**
- Purpose: Fine-grained permission checking for admin operations
- Examples: `apps/api/src/middleware/admin-rbac.ts`
- Pattern: Middleware parses JWT role claim; individual routes decide which roles allowed
- Benefit: Central JWT source of truth for permissions

## Entry Points

**API Server:**
- Location: `apps/api/src/server.ts`
- Triggers: `npm run dev:api` or production process manager
- Responsibilities:
  - Imports and configures Express app from `app.ts`
  - Starts payout scheduler background job
  - Listens on `$PORT` and `$HOST` from env
  - Logs N8N configuration on startup

**Express App Setup:**
- Location: `apps/api/src/app.ts`
- Triggers: Imported by server.ts
- Responsibilities:
  - Registers middleware in order: CORS → content-type normalization → request context → body parsing → route mounting
  - Mounts all 20 route handlers at versioned paths (`/v1/...`)
  - Serves root health check HTML page at `/`
  - Implements CORS origin matching (supports `*`, exact origins, and `://*.domain.com` wildcards)

**Admin Panel:**
- Location: `apps/admin/src/main.tsx`
- Triggers: `npm run dev:admin` (dev) or Vite build (prod)
- Responsibilities: React root, mounts React Router, renders AppShell with global state

**AppShell:**
- Location: `apps/admin/src/AppShell.tsx`
- Triggers: Rendered as main app layout
- Responsibilities:
  - Global search (API-backed)
  - Login/logout flow
  - Route rendering with lazy-loaded pages
  - Dark mode, language toggle (English/Turkish)
  - Profile menu
  - Api health badge

**Mobile Entry:**
- Location: `apps/mobile/src/screens/HomeScreen.tsx` and LoginScreen
- Triggers: Expo development or production app build
- Responsibilities: Main buyer/seller UI; orchestrates voice session flow, order browsing, payment

**Voice Agent Entrypoint:**
- Location: `apps/voice-agent/src/voice_agent/entrypoint.py`
- Triggers: `python -m voice_agent.entrypoint` (worker process)
- Responsibilities:
  - Registers as LiveKit Agents worker
  - Listens for job dispatch events
  - Instantiates VoiceSalesAgent per session
  - Handles VAD, STT, LLM, TTS pipeline
  - Fires N8N webhook on session end

**Voice Agent Join API:**
- Location: `apps/voice-agent/src/voice_agent/join_api.py`
- Triggers: `uvicorn voice_agent.join_api:app --port 9000`
- Responsibilities:
  - FastAPI endpoint called by mobile at `POST /join`
  - Generates LiveKit room tokens
  - Returns room name + token to mobile

## Error Handling

**Strategy:** Consistent JSON error format across all endpoints. Request must be valid JSON; 415 errors on malformed content-type. All domain errors use standard shape.

**Error Response Format:**
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {} // Optional: validation error details
  }
}
```

**HTTP Status Codes:**
- 200/201: Success
- 400: Validation error, invalid request schema
- 401: Missing or invalid JWT token
- 403: Forbidden (wrong realm, insufficient role, state machine violation)
- 415: Unsupported Content-Type (automatically retried by admin panel with text/plain fallback)

**Patterns:**
- Route handlers catch exceptions and return 400/500 with error code
- State machine violations return 403 with descriptive code (e.g., "INVALID_STATE_TRANSITION")
- Auth failures return 401 "UNAUTHORIZED" or 403 "AUTH_REALM_MISMATCH"
- Validation errors return 400 with Zod error details flattened

## Cross-Cutting Concerns

**Logging:** JSON-formatted logs to stdout via `console.log()`. Request logger emits `http_request` type with method, path, status, duration. Services log via named loggers (e.g., `llm_request_logger`, `n8n_request_logger`).

**Validation:** Zod schemas on every route handler input. Shared schema exports from route files. Error responses flatten Zod errors into details object.

**Authentication:** JWT-based with two realms. Access tokens (short-lived) + refresh tokens in pairs. Middleware chain verifies token, extracts userId/role/realm, attaches to `req.auth`. Admin panel auto-refreshes on 401.

**Authorization:** Role-based (buyer/seller in app realm, super_admin/admin in admin realm). Checked at route level via middleware or inline in handler. State machine enforces actor-specific transitions.

**Idempotency:** Request deduplication via `x-idempotency-key` header and `x-idempotency-scope` header. Middleware stores response for repeat requests. Scope groups keys (e.g., "order_create").

**Abuse Protection:** Rate limiting middleware with IP-based and user-based limits. Per-flow configuration (e.g., order creation: 30/IP, 20/user per minute).

---

*Architecture analysis: 2026-03-21*
