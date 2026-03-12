# Architecture

**Analysis Date:** 2026-03-12

## Pattern Overview

**Overall:** Microservices monorepo with layered Express API backend, separate frontend (React admin + React Native mobile), and independent Python-based LiveKit voice agent.

**Key Characteristics:**
- **Polyglot services:** Node.js/TypeScript API, React-based frontends, Python voice agent
- **Shared type system:** @coziyoo/shared-types provides cross-service type definitions
- **JWT realm separation:** Two independent JWT realms (app/admin) with separate secrets
- **Event-driven voice:** Voice agent runs as LiveKit Agents worker with state machine-based order tracking
- **Database-centric:** Single PostgreSQL instance with numbered migrations for all services

## Layers

**Presentation (API Response):**
- Purpose: Standardized JSON responses with error envelopes
- Location: Route handlers throughout `apps/api/src/routes/`
- Contains: HTTP response formatting, status codes, error codes
- Pattern: All errors conform to `{ error: { code, message } }` shape
- Used by: Mobile clients, admin panel, external integrations

**Route/Handler Layer:**
- Purpose: HTTP endpoint definitions and request routing
- Location: `apps/api/src/routes/` (23 route files)
- Contains: Express Router instances, request validation with Zod, handler business logic
- Depends on: Middleware, services, database client
- Pattern: Named exports (e.g., `export const authRouter = Router()`)
- Sections:
  - Public auth: `auth.ts`, `health.ts`
  - Admin realm: `admin-auth.ts`, `admin-dashboard.ts`, `admin-users.ts`, `admin-audit.ts`, `admin-system.ts`, `admin-metadata.ts`, `admin-api-tokens.ts`, `admin-livekit.ts`, `admin-sales-commission-settings.ts`
  - App realm: `orders.ts`, `payments.ts`, `finance.ts`, `compliance.ts`, `delivery-proof.ts`, `lots.ts`, `order-allergen.ts`
  - Voice: `livekit.ts`, `voice.ts`
  - Metadata: `docs.ts`

**Middleware Layer:**
- Purpose: Request preprocessing and cross-cutting concerns
- Location: `apps/api/src/middleware/`
- Execution order: CORS → content-type normalization → request context → auth → abuse protection → idempotency → rate limiting
- Key middleware:
  - `observability.ts`: Adds `requestId` and logs JSON request metrics
  - `auth.ts`: Bearer token validation, extracts auth context to `req.auth`
  - `abuse-protection.ts`: Rate limiting per IP and user ID
  - `idempotency.ts`: Idempotency key handling for payment safety
  - `admin-rbac.ts`: Role-based access control for admin endpoints
  - `app-role.ts`: Seller/buyer role detection for app endpoints
- Used by: Route handlers via `requireAuth()` and `abuseProtection()` middleware factories

**Service Layer:**
- Purpose: Business logic, state management, external service integration
- Location: `apps/api/src/services/` (15 service files)
- Contains: Data transformations, complex business rules, external API calls, domain operations
- Key services:
  - `token-service.ts`: JWT signing/verification for two realms
  - `order-state-machine.ts`: Order status transitions and permission checks
  - `livekit.ts`: LiveKit API integration, token generation
  - `n8n.ts`: N8N webhook dispatch for order processing
  - `finance.ts`: Revenue tracking, payouts, commission calculations
  - `payouts.ts`: Payout record management
  - `payout-scheduler.ts`: Scheduled payout processing (starts at server init)
  - `admin-audit.ts`: Admin action logging
  - `user-presence.ts`: Track user online status
  - `ollama.ts`: LLM provider integration
  - `resolve-providers.ts`: Dynamic provider resolution for payments/TTS
  - `tts-engines.ts`: Text-to-speech provider abstraction
  - `starter-agent-settings.ts`: Voice agent configuration
  - `outbox.ts`: Outbox pattern for reliable events
  - `lots.ts`: Food lot management

**Data Access Layer:**
- Purpose: Database communication
- Location: `apps/api/src/db/`
- Components:
  - `client.ts`: PostgreSQL connection pool (pg driver) with SSL negotiation
  - `migrations/`: Sequential SQL files (0001 through 0005 currently)
- Pattern: Direct SQL queries via pool in route/service handlers, no ORM
- Configuration: Reads from env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, DATABASE_URL)

**Configuration:**
- Purpose: Environment variable validation and typed access
- Location: `apps/api/src/config/env.ts`
- Pattern: Zod schema validation on import, single `env` export
- Covers: Database, JWT secrets, API endpoints, external services, feature flags

## Data Flow

**User Authentication (App Realm):**

1. Client POSTs email/password to `POST /auth/register` or `POST /auth/login`
2. Handler validates input with Zod schema
3. Handler hashes password (Argon2) or verifies existing hash
4. Handler generates refresh token (UUID), hashes with Argon2, stores in `user_sessions` table
5. Handler calls `signAccessToken()` to create JWT (signed with APP_JWT_SECRET, TTL from env)
6. Response includes access token, refresh token, user metadata
7. Subsequent requests include `Authorization: Bearer <token>`
8. `requireAuth("app")` middleware verifies JWT, extracts `sub` (user ID), `sessionId`, `role`, stores in `req.auth`

**Admin Authentication (Admin Realm):**

1. Similar to app flow but uses separate `admin_users` table
2. Calls `signAccessToken()` with `realm: "admin"` parameter
3. Uses ADMIN_JWT_SECRET (different key)
4. `requireAuth("admin")` verifies against admin realm secret
5. Admin audit logging on failed login attempt

**Order Lifecycle:**

1. Buyer creates order via `POST /orders` (requires app realm auth, buyer role)
2. Order state machine validates transition from `pending_seller_approval` to next state
3. Handler inserts order record, notifies seller via N8N webhook
4. Seller updates status to `seller_approved`, `rejected`, or `cancelled`
5. State machine enforces transitions: pending → approved → payment → preparing → ready → delivery → completed/rejected/cancelled
6. Payment integration triggered at `awaiting_payment` state
7. Order completion fires N8N webhook to trigger fulfillment workflow
8. Finance service computes commissions and seller payouts based on order final state

**Voice Agent Dispatch:**

1. Mobile app calls `POST /voice/join` (requires app realm auth)
2. Handler validates session, calls AI server at `AI_SERVER_URL + /livekit/agent-session`
3. Shared secret authentication between API and voice agent
4. Voice agent entrypoint receives job context with metadata (system prompt, user memory, order context)
5. Agent creates LiveKit room, connects as participant
6. Agent pipeline: VAD (Silero) → STT (Whisper or configured provider) → LLM (Ollama) → TTS (F5/XTTS/Chatterbox)
7. Agent outputs UI action commands via LiveKit data channel (JSON commands like "show_menu", "place_order")
8. Agent logs end-of-call metrics, fires N8N webhook for order processing

**State Management:**

- **Database as source of truth:** All user, order, and finance state persists to PostgreSQL
- **No in-memory state:** Services are stateless except configuration
- **Idempotency:** Payment routes use idempotency keys (hashed to prevent duplicates)
- **Audit trail:** Admin actions logged to `admin_auth_audit`, `activity_audit` tables
- **Request tracking:** Every request gets UUID via `requestContext` middleware, included in logs

## Key Abstractions

**Order State Machine:**
- Purpose: Enforce valid order status transitions, authorize state changes by role
- Examples: `apps/api/src/services/order-state-machine.ts`
- Pattern: Explicit state transition matrix, role-based permission checks
- Functions: `canTransition()`, `canActorSetStatus()`, `isTerminalStatus()`

**JWT Token Service:**
- Purpose: Centralized token creation/verification for two realms
- Examples: `apps/api/src/services/token-service.ts`
- Pattern: Single function per operation, separate secrets per realm, configurable TTL
- Types: `AuthRealm` union type ("app" | "admin"), `AccessTokenPayload` interface

**LiveKit Integration:**
- Purpose: Abstract room creation, token generation, participant management
- Examples: `apps/api/src/services/livekit.ts`
- Pattern: Methods for each operation (generate token, create room, list participants)

**Provider Resolution:**
- Purpose: Dynamic selection of payment, TTS, STT providers based on configuration
- Examples: `apps/api/src/services/resolve-providers.ts`
- Pattern: Factory functions that select provider based on env vars

**Audio Processing (Voice Agent):**
- Purpose: Pipeline for speech-to-text, LLM inference, text-to-speech
- Examples: `apps/voice-agent/src/voice_agent/entrypoint.py`
- Pattern: LiveKit Agents worker with pluggable processors (Silero VAD, Ollama LLM, configurable TTS)

## Entry Points

**API Server:**
- Location: `apps/api/src/server.ts`
- Triggers: `npm run dev` (tsx watch) or `node dist/src/server.js` (production)
- Responsibilities: Starts Express server on configured host/port, initializes payout scheduler
- Also triggers: Database migration check (via installation scripts before start)

**Admin Panel:**
- Location: `apps/admin/src/main.tsx`
- Triggers: `npm run dev` (Vite dev server) or `npm run build` (static build)
- Responsibilities: Vite serves React app, connects to API via fetch

**Mobile App:**
- Location: `apps/mobile/src/screens/` (screen entry points)
- Triggers: `npm start` (Expo), `npm run ios`, `npm run android`
- Responsibilities: Expo runtime loads screens, LiveKit for voice sessions

**Voice Agent:**
- Location: `apps/voice-agent/src/voice_agent/entrypoint.py`
- Triggers: `python -m voice_agent.entrypoint` (worker) or `uvicorn voice_agent.join_api:app` (dispatch API)
- Responsibilities: Registers as LiveKit agent worker, processes job contexts, generates audio/UI actions

## Error Handling

**Strategy:** Standardized error envelope with machine-readable codes and human-readable messages

**Patterns:**

Standard response shape:
```typescript
{ error: { code: "ERROR_CODE", message: "Human-readable description" } }
```

HTTP status codes:
- `400`: Validation error (Zod schema failure) → code: `VALIDATION_ERROR`
- `401`: Missing/invalid auth token → code: `UNAUTHORIZED` or `TOKEN_INVALID`
- `403`: Insufficient permissions (wrong realm, wrong role) → code: `AUTH_REALM_MISMATCH`, `FORBIDDEN`
- `415`: Unsupported content-type (caught by middleware) → implicit error
- `500`: Unhandled server error (logs as JSON)

Auth-specific codes:
- `UNAUTHORIZED`: Bearer token missing
- `TOKEN_INVALID`: Token expired or signature invalid
- `AUTH_REALM_MISMATCH`: Token realm doesn't match endpoint
- `INVALID_CREDENTIALS`: Login failed

Order-specific codes:
- `INVALID_ORDER_STATUS`: Requested state transition not allowed
- `ORDER_NOT_FOUND`: Order ID doesn't exist

Database errors are caught and returned as `500` with generic message (details logged only on server)

## Cross-Cutting Concerns

**Logging:**
- Framework: `console.log()` with JSON output
- Pattern: `{ level, type, requestId, method, path, statusCode, durationMs }` (from observability middleware)
- Additional: Services log structured data ad-hoc via console.log
- Storage: Docker logs or redirected to files via systemd

**Validation:**
- Framework: Zod schemas for all request bodies
- Pattern: Early validation in route handler, return `400` with parsed errors if invalid
- Reuse: Same schemas across related endpoints (e.g., LoginSchema in auth.ts)

**Authentication:**
- Strategy: Bearer tokens in Authorization header, separate realms with separate secrets
- Implementation: `requireAuth(realm)` middleware factory
- Session storage: Refresh tokens hashed and stored per user, access tokens are stateless JWTs

**Rate Limiting:**
- Framework: Custom `abuseProtection()` middleware with per-flow configuration
- Pattern: Tracks hits by IP and user ID separately, configurable limits and windows
- Usage: Applied to sensitive endpoints (auth, display name checks, payment)

**Idempotency:**
- Pattern: Idempotency key header stored in `idempotency_results` table
- Implementation: Middleware checks for duplicate requests, returns cached response if seen before
- Used for: Payment operations to prevent duplicate charges

**CORS:**
- Pattern: Custom origin matching with wildcard support (e.g., `https://*.example.com`)
- Configuration: `CORS_ALLOWED_ORIGINS` env var (comma-separated)
- Behavior: Adds `Access-Control-Allow-*` headers, preflight requests return 204

---

*Architecture analysis: 2026-03-12*
