# Architecture Patterns

**Domain:** Voice Agent Dashboard (internal ops tool)
**Researched:** 2026-03-22

## Recommended Architecture

The voice dashboard is a Next.js App Router application (`apps/voice-dashboard`) that authenticates with the existing admin JWT realm, calls the existing Express API for data, and introduces two new database tables: `agent_profiles` (replaces `starter_agent_settings`) and `call_logs` (new). The Python voice agent reads the active profile at session join time via the existing metadata-passing mechanism -- the API resolves the active profile and injects its config into the LiveKit dispatch metadata.

### System Context

```
                    agent.coziyoo.com
                          |
                   [Nginx Proxy Manager]
                          |
              [apps/voice-dashboard :3001]
                    Next.js App Router
                          |
                   (admin JWT auth)
                          |
              [apps/api :3000] -----> [PostgreSQL]
               Express REST API          |
                    |                    |
                    | (dispatch)         | (read at join)
                    v                    |
           [apps/voice-agent :9000]------+
              Python/LiveKit Worker
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `apps/voice-dashboard` | Profile CRUD UI, call log viewer, activation toggle | `apps/api` via HTTP (admin JWT) |
| `apps/api` (existing + new routes) | Profile CRUD endpoints, active profile resolution, call log storage | PostgreSQL, `apps/voice-agent` (dispatch) |
| `apps/voice-agent` (unchanged) | Reads provider config from dispatch metadata, writes session-end event | `apps/api` (session/end), LiveKit |
| PostgreSQL | Stores `agent_profiles`, `call_logs` | All services |

## Data Flow

### Profile Activation Flow (the critical path)

This is the most important flow to get right. It determines how a dashboard config change reaches a live voice call.

```
1. Admin opens dashboard, creates/edits profile "Sales v2"
   -> POST /v1/admin/agent-profiles        (CRUD)
   -> Writes to agent_profiles table

2. Admin clicks "Activate" on "Sales v2"
   -> POST /v1/admin/agent-profiles/:id/activate
   -> BEGIN transaction
   -> UPDATE agent_profiles SET is_active = FALSE WHERE is_active = TRUE
   -> UPDATE agent_profiles SET is_active = TRUE WHERE id = :id
   -> COMMIT

3. Mobile user starts voice session
   -> POST /v1/livekit/session/start
   -> API calls getActiveAgentProfile()  [NEW function]
   -> API calls resolveProviders(activeProfile)
   -> Providers + systemPrompt + greetingConfig injected into dispatch metadata
   -> Agent receives metadata in ctx.job.metadata
   -> Agent builds STT/LLM/TTS from metadata.providers (existing code, unchanged)
```

**Key insight:** The Python voice agent already reads all its config from `ctx.job.metadata.providers`. The API already resolves providers from `starter_agent_settings` and injects them into dispatch metadata. The new profile system just changes _which_ record the API reads from. The voice agent code needs zero changes.

### Call Log Write Path

Currently, session-end data is sent to N8N via webhook and not persisted in PostgreSQL. The dashboard needs call logs in the database.

```
1. Voice agent session ends
   -> Agent calls POST /v1/livekit/session/end (existing)
   -> API currently forwards to N8N webhook

2. NEW: API also writes to call_logs table before/after N8N forward
   -> INSERT INTO call_logs (room_name, profile_id, started_at, ended_at, ...)
   -> Then forward to N8N as before (existing behavior preserved)

3. Dashboard reads call logs
   -> GET /v1/admin/call-logs?page=1&limit=20
   -> Returns paginated call log list with profile name, duration, outcome
```

**Who writes call logs:** The Express API, in the existing `/v1/livekit/session/end` handler. This is the cleanest approach because:
- The API already receives session-end data from the Python agent
- Adding a DB write before the N8N forward is a single-line addition to existing code
- No changes needed in the Python agent
- The API already has the database connection pool

### Dashboard Authentication Flow

```
1. User visits agent.coziyoo.com
2. Next.js checks for admin JWT in cookies/localStorage
3. If missing -> redirect to /login
4. Login form POSTs to /v1/admin/auth/login (existing endpoint)
5. Receives access + refresh token pair
6. Stores tokens, redirects to dashboard
7. All API calls include Authorization: Bearer <access_token>
8. On 401 -> attempt refresh via /v1/admin/auth/refresh (existing)
9. If refresh fails -> redirect to /login
```

This is identical to how `apps/admin` works. The JWT realm is `admin`, verified by `requireAuth("admin")` middleware.

## Database Schema Direction

### Table: `agent_profiles` (replaces `starter_agent_settings`)

The existing `starter_agent_settings` table uses `device_id` as its primary key and stores all config in a `tts_config_json` JSONB blob. The new `agent_profiles` table should be a clean schema that the dashboard manages directly.

**Recommendation:** Create a new `agent_profiles` table rather than modifying `starter_agent_settings`. Migrate the active settings data once, then update the API's `getStarterAgentSettingsWithDefault` to read from `agent_profiles` where `is_active = TRUE`. This avoids breaking the existing `device_id`-based lookup during the transition.

```sql
CREATE TABLE agent_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,                    -- "Sales v2", "Support Turkish"
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,

  -- LLM config
  system_prompt TEXT,
  greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  greeting_instruction TEXT,
  voice_language TEXT NOT NULL DEFAULT 'tr',

  -- Provider config (structured, not a blob)
  stt_config    JSONB NOT NULL DEFAULT '{}',      -- {provider, baseUrl, model, ...}
  tts_config    JSONB NOT NULL DEFAULT '{}',      -- {engine, baseUrl, synthPath, bodyParams, ...}
  llm_config    JSONB NOT NULL DEFAULT '{}',      -- {baseUrl, model, ...}
  n8n_config    JSONB NOT NULL DEFAULT '{}',      -- {baseUrl, webhookPath, ...}
  tools_config  JSONB NOT NULL DEFAULT '{}',      -- future: tool definitions

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one profile can be active at a time
CREATE UNIQUE INDEX agent_profiles_one_active_idx
  ON agent_profiles (is_active) WHERE is_active = TRUE;
```

**Why separate JSONB columns instead of one blob:** The existing `tts_config_json` blob that stores STT, TTS, N8N, and server arrays in a single column is hard to reason about and query. Splitting into `stt_config`, `tts_config`, `llm_config`, `n8n_config` maps directly to the dashboard tabs (Model | Voice | Transcriber | Tools) and makes partial updates cleaner.

### Table: `call_logs`

```sql
CREATE TABLE call_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_name     TEXT NOT NULL,
  profile_id    UUID REFERENCES agent_profiles(id) ON DELETE SET NULL,
  profile_name  TEXT,                             -- denormalized for history

  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
  ) STORED,

  -- Session participants
  user_identity TEXT,
  agent_identity TEXT,
  device_id     TEXT,

  -- Outcome
  outcome       TEXT,                             -- 'completed', 'abandoned', 'error'
  sentiment     TEXT,                             -- 'positive', 'neutral', 'negative'
  summary       TEXT,                             -- agent-generated summary

  -- Raw metadata for debugging
  metadata      JSONB DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_logs_created_at_idx ON call_logs (created_at DESC);
CREATE INDEX call_logs_profile_id_idx ON call_logs (profile_id);
```

**Apply these directly to Supabase** (per project constraints -- do NOT create migration files).

## Next.js App Structure

Use App Router because it provides server components for the dashboard shell (sidebar, navigation) and client components only where interactivity is needed (profile editor forms, call log table with sorting/filtering).

```
apps/voice-dashboard/
  package.json
  next.config.ts
  tsconfig.json
  src/
    app/
      layout.tsx              -- Root layout: sidebar + main area
      page.tsx                -- Redirect to /profiles
      login/
        page.tsx              -- Login form (client component)
      profiles/
        page.tsx              -- Profile list (server component)
        [id]/
          page.tsx            -- Profile detail/edit page
          loading.tsx         -- Loading skeleton
      call-logs/
        page.tsx              -- Paginated call log table
      settings/
        page.tsx              -- Dashboard settings (API status, connection tests)
    components/
      sidebar.tsx             -- Left nav: profile list + call logs link
      profile-form.tsx        -- Tabbed form: Model | Voice | Transcriber | Tools
      profile-card.tsx        -- Profile list item with activate button
      call-log-table.tsx      -- Sortable/filterable table
      connection-test.tsx     -- Test STT/TTS/N8N connectivity
      auth-provider.tsx       -- Client context for JWT management
    lib/
      api.ts                  -- HTTP client with JWT auto-refresh (port from apps/admin)
      auth.ts                 -- Token storage, login/logout
      types.ts                -- AgentProfile, CallLog types
    middleware.ts             -- Next.js middleware: redirect unauthenticated to /login
```

### Why App Router over Pages Router

- Server components for the layout shell reduce client JS bundle
- Route groups map cleanly to the dashboard sections
- `middleware.ts` handles auth redirects at the edge
- Loading states via `loading.tsx` conventions
- No SSR data fetching complexity -- all data comes from the Express API via client-side fetch or server-side fetch with forwarded JWT

### Dashboard Port & Deployment

- Dev: port 3001 (`next dev -p 3001`)
- Prod: `next build && next start -p 3001` (or static export if no server features needed)
- Nginx: `agent.coziyoo.com -> 127.0.0.1:3001`
- Systemd: `coziyoo-voice-dashboard` service

## API Routes: Existing vs New

### Existing routes the dashboard calls directly (no changes needed)

| Route | Purpose | Used For |
|-------|---------|----------|
| `POST /v1/admin/auth/login` | Admin login | Dashboard authentication |
| `POST /v1/admin/auth/refresh` | Token refresh | Session maintenance |
| `GET /v1/admin/livekit/status` | LiveKit config status | Settings page |
| `POST /v1/admin/livekit/test/stt` | Test STT server | Connection test in profile editor |
| `POST /v1/admin/livekit/test/tts` | Test TTS server | Connection test in profile editor |
| `POST /v1/admin/livekit/test/n8n` | Test N8N server | Connection test in profile editor |
| `POST /v1/admin/livekit/test/livekit` | Test LiveKit | Connection test in settings |

### New routes needed

| Route | Method | Purpose |
|-------|--------|---------|
| `/v1/admin/agent-profiles` | GET | List all profiles |
| `/v1/admin/agent-profiles` | POST | Create profile |
| `/v1/admin/agent-profiles/:id` | GET | Get profile detail |
| `/v1/admin/agent-profiles/:id` | PUT | Update profile |
| `/v1/admin/agent-profiles/:id` | DELETE | Delete profile |
| `/v1/admin/agent-profiles/:id/activate` | POST | Set as active profile |
| `/v1/admin/agent-profiles/:id/duplicate` | POST | Clone profile |
| `/v1/admin/call-logs` | GET | List call logs (paginated) |
| `/v1/admin/call-logs/:id` | GET | Call log detail |
| `/v1/admin/call-logs/stats` | GET | Aggregate stats (calls/day, avg duration) |

### Modified existing route

| Route | Change |
|-------|--------|
| `POST /v1/livekit/session/end` | Add call_log INSERT before N8N forward |
| `getStarterAgentSettingsWithDefault()` | Fall back to `agent_profiles WHERE is_active = TRUE` |

## Patterns to Follow

### Pattern 1: API Client with JWT Refresh

**What:** Port the admin panel's `request()` wrapper from `apps/admin/src/lib/api.ts` to the dashboard. It handles automatic token refresh on 401 responses.

**When:** Every API call from the dashboard.

**Why:** The existing pattern is battle-tested in the admin panel. Do not reinvent it.

```typescript
// apps/voice-dashboard/src/lib/api.ts
// Port from apps/admin/src/lib/api.ts with minimal changes:
// - Same token storage pattern (localStorage)
// - Same 401 -> refresh -> retry logic
// - Point to same API base URL (api.coziyoo.com)
```

### Pattern 2: Active Profile Resolution Chain

**What:** When the API needs the active profile config for a voice session, it follows a resolution chain:

```
1. If settingsProfileId in request -> use that specific profile
2. Else -> SELECT * FROM agent_profiles WHERE is_active = TRUE
3. If no active profile -> fall back to starter_agent_settings "default"
4. If nothing -> use hardcoded defaults
```

**Why:** Backward compatibility. Existing mobile sessions that pass `deviceId` continue working. New sessions use the active profile.

### Pattern 3: Profile Form as Tabbed Editor

**What:** The profile edit page uses tabs matching the vapi.ai pattern: Model | Voice | Transcriber | Tools.

**When:** Editing any profile.

**Why:** Each tab maps to a JSONB column (`llm_config`, `tts_config`, `stt_config`, `n8n_config/tools_config`). Tabs provide clear separation of concerns and match the target UX.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Direct Database Access from Next.js

**What:** Importing `pg` or Prisma in the Next.js app to query PostgreSQL directly.

**Why bad:** Breaks the architecture boundary. The Express API is the single data access layer. Bypassing it means duplicating auth checks, validation, and business logic.

**Instead:** All data access goes through the Express API via HTTP. The Next.js app is a pure frontend that happens to be server-rendered.

### Anti-Pattern 2: Python Agent Fetching Profile from API

**What:** Having the Python voice agent make an HTTP call to the API to fetch the active profile at session start.

**Why bad:** Adds latency to session join, creates a circular dependency (API dispatches agent, agent calls API), and the metadata-passing mechanism already solves this.

**Instead:** The API resolves the active profile and injects it into the LiveKit dispatch metadata. The agent reads `ctx.job.metadata.providers` as it already does. Zero changes to the Python code.

### Anti-Pattern 3: Storing Call Logs in a Separate Service

**What:** Writing call logs from the Python agent directly to a separate database or logging service.

**Why bad:** The agent already POSTs session-end data to the Express API. Adding another write destination means two failure modes and data consistency issues.

**Instead:** The Express API writes to `call_logs` table in its existing `/v1/livekit/session/end` handler, then forwards to N8N as before.

## Build Order (Dependencies)

This is critical for phase planning. Items must be built in this order because of hard dependencies.

```
Phase 1: Database + API Routes (foundation)
  1a. Create agent_profiles table in Supabase
  1b. Create call_logs table in Supabase
  1c. Build /v1/admin/agent-profiles CRUD routes
  1d. Build /v1/admin/call-logs read routes
  1e. Modify /v1/livekit/session/end to write call_logs
  1f. Update getStarterAgentSettingsWithDefault to resolve from agent_profiles

Phase 2: Next.js App Shell (skeleton)
  2a. Scaffold apps/voice-dashboard workspace
  2b. Auth flow (login page, JWT storage, middleware redirect)
  2c. Layout with sidebar navigation
  2d. API client library (port from apps/admin)

Phase 3: Profile Management (core feature)
  3a. Profile list page
  3b. Profile create/edit form (tabbed: Model | Voice | Transcriber | Tools)
  3c. Activate/deactivate toggle
  3d. Connection testing (reuse existing admin API test endpoints)

Phase 4: Call Logs (monitoring)
  4a. Call log list page (paginated table)
  4b. Call log detail view
  4c. Aggregate stats (calls/day, avg duration, success rate)

Phase 5: Deployment
  5a. Build configuration (next build)
  5b. Systemd service file
  5c. Nginx proxy configuration
  5d. Update CI/CD pipeline
  5e. Migrate existing starter_agent_settings data to agent_profiles
```

**Why this order:**
- Phase 1 before Phase 2: The dashboard needs API endpoints to call. Building API first allows testing with curl/Postman before the UI exists.
- Phase 2 before Phase 3: Profile forms need the auth flow and API client to work.
- Phase 3 before Phase 4: Call logs reference profiles. Also, activation must work before call logs can record which profile was active.
- Phase 5 last: Deployment only after the features work locally.

## Scalability Considerations

| Concern | At current scale | At 10K calls/day | Notes |
|---------|-----------------|-------------------|-------|
| Call log storage | No concern | Add retention policy (DELETE WHERE created_at < 90 days) | JSONB metadata column could grow |
| Profile resolution | Single query | No concern (one active row, indexed) | Unique partial index ensures fast lookup |
| Dashboard performance | No concern | No concern (internal tool, <10 users) | SSR not critical for this use case |

## Sources

- Existing codebase analysis: `apps/api/src/routes/livekit.ts`, `apps/api/src/routes/admin-livekit.ts`
- Existing codebase analysis: `apps/api/src/services/starter-agent-settings.ts`, `apps/api/src/services/resolve-providers.ts`
- Existing codebase analysis: `apps/voice-agent/src/voice_agent/entrypoint.py` (metadata consumption pattern)
- Existing codebase analysis: `apps/voice-agent/src/voice_agent/join_api.py` (session log viewer)
- Project requirements: `.planning/PROJECT.md`
- Architecture documentation: `.planning/codebase/ARCHITECTURE.md`

---

*Architecture research: 2026-03-22*
