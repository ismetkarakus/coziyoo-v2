# Project Research Summary

**Project:** Voice Agent Dashboard (apps/voice-dashboard)
**Domain:** Internal voice agent configuration and monitoring dashboard
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

The voice dashboard is an internal ops tool that replaces the existing `VoiceAgentSettingsPage` in the admin panel with a dedicated Next.js application at `agent.coziyoo.com`. Experts in this domain (vapi.ai, retell.ai) converge on a tabbed configuration layout (Model | Voice | Transcriber | Tools) with a left-sidebar profile list — this pattern maps directly to the existing data model and should be adopted without modification. The recommended approach is to build a Next.js 16 App Router client-heavy SPA that authenticates via the existing admin JWT realm, calls the existing Express API for all data, and introduces two new database tables (`agent_profiles` and `call_logs`) applied directly to Supabase. The Python voice agent requires zero changes — all config propagation happens through the existing metadata-injection mechanism at session dispatch time.

The critical architectural insight is that the dashboard does not need to be ambitious. The existing codebase already implements connection testing, profile activation transactions, CURL parsing, multi-server configurations, and JWT auto-refresh. Most of Phase 1 is porting and reorganizing existing capabilities into a better UI rather than building from scratch. The primary new work is: new database tables, new API routes for profiles CRUD, and new API routes for call log storage and retrieval.

The biggest risks are operational rather than technical: CORS misconfiguration will block the dashboard from calling the API on day one; the npm workspace hoisting can cause silent React version conflicts; and the existing `VoiceAgentSettingsPage` must be deprecated before the new dashboard goes live to avoid split-brain state. Each of these is a Phase 1 concern that must be resolved before feature development begins.

## Key Findings

### Recommended Stack

The stack research recommends Next.js 16.2 with App Router, React 19, TypeScript 5.9, Tailwind CSS v4, and shadcn/ui for components. This is a high-confidence, well-documented combination with first-class support in all referenced tools. For data management, TanStack Query 5 handles server state and caching, React Hook Form 7 + Zod 4 handles form management and validation (Zod already used in the API), and TanStack Table 8 handles the call log data table. Auth reuses the existing admin panel pattern verbatim — custom JWT wrapper with sessionStorage, auto-refresh on 401.

The research is explicit about what NOT to use: no global state library (TanStack Query is sufficient), no ORM (no direct DB access from Next.js), no Server Actions for mutations (REST API is the single backend), no NextAuth (the Express API already has admin auth). These exclusions are as important as the inclusions.

**Core technologies:**
- Next.js 16.2 (App Router): App framework — latest stable, Turbopack default, file-based routing maps to dashboard sections
- React 19: UI library — ships with Next.js 16, React Compiler eliminates manual memoization
- TypeScript 5.9: Type safety — matches monorepo version, strict mode per existing conventions
- Tailwind CSS v4: Styling — CSS-first config, no config file, 5x faster builds than v3
- shadcn/ui: Components — copied source ownership, Radix primitives, Tabs/Card/Sidebar/DataTable all needed
- TanStack Query v5: Server state — fetching, caching, optimistic updates for profile CRUD and call logs
- React Hook Form 7 + Zod 4: Forms — uncontrolled components for the 15+ field profile config form
- TanStack Table 8: Data display — headless, pairs with shadcn DataTable for call logs

### Expected Features

The feature research identifies 10 table-stakes features for the MVP and 10 differentiators for Phase 2, validated against vapi.ai and retell.ai reference dashboards. All table-stakes features already have API endpoints or data in the existing codebase — this is primarily a UI build, not a backend build.

**Must have (table stakes — Phase 1):**
- Admin JWT authentication — gate all features, reuse existing admin realm
- Profile list with create/delete — left-sidebar pattern per vapi.ai reference
- Active profile toggle — exclusive activation, API endpoint already exists
- 4-tab config layout (Model | Voice | Transcriber | Tools) — maps to JSONB columns
- LLM configuration — provider, model, base URL, system prompt, greeting config
- STT configuration — provider, base URL, model, language, auth header
- TTS configuration — provider, base URL, voice ID, body params, auth header
- Tools/N8N configuration — webhook URLs, MCP paths
- Connection testing for all providers — API test endpoints already exist
- Save with toast feedback — standard UX

**Should have (differentiators — Phase 2):**
- Call logs viewer — session history with profile linkage, duration, outcome
- Profile duplication (clone) — fast iteration on working configs
- cURL import for server config — already implemented in `parseCurlCommand()`, needs porting
- Live TTS audio preview — test endpoint exists, needs in-browser playback
- Live STT transcription test — test endpoint exists, needs mic recording UI
- Model auto-discovery — fetch from Ollama `/api/tags`
- Dark mode — CSS concern, add anytime

**Defer indefinitely:**
- Multi-tenant team management, phone number management, billing, flow designer, automated evaluation suites, real-time call monitoring, analytics boards

### Architecture Approach

The dashboard is a Next.js App Router client-heavy SPA with no direct database access. All data flows through the existing Express API. The architecture introduces two new database tables (`agent_profiles` replacing `starter_agent_settings`, and `call_logs`) and a set of new REST routes under `/v1/admin/agent-profiles` and `/v1/admin/call-logs`. The critical data flow for profile activation is already implemented — the API injects active profile config into LiveKit dispatch metadata, which the Python agent reads at session join. Changing the profile source from `starter_agent_settings` to `agent_profiles` is the only code change the existing voice session path requires.

**Major components:**
1. `apps/voice-dashboard` (Next.js) — Profile CRUD UI, call log viewer, activation toggle; communicates with Express API via HTTP (admin JWT)
2. `apps/api` (Express, existing + new routes) — Profile CRUD endpoints, active profile resolution, call log storage; communicates with PostgreSQL and voice agent
3. `agent_profiles` table (Supabase) — Replaces `starter_agent_settings`; UUID primary key, named profiles, separate JSONB columns per config domain, partial unique index on `is_active`
4. `call_logs` table (Supabase) — Explicit columns for queryable fields (profile_id, started_at, ended_at, duration_ms generated, outcome); JSONB for raw metadata
5. `apps/voice-agent` (Python, unchanged) — Reads config from `ctx.job.metadata.providers` as before; no code changes required

### Critical Pitfalls

1. **CORS rejection on first API call** — Add `http://localhost:3001` and `https://agent.coziyoo.com` to `CORS_ALLOWED_ORIGINS` defaults in `env.ts` and `.env.example` before writing any dashboard code. The production `.env` already has the domain but templates do not.

2. **JWT refresh token race condition** — Both admin panel and voice dashboard share the admin JWT realm. Use Option A (separate login sessions per app — each calls `/admin/auth/login` independently and maintains its own refresh token chain). No backend changes required.

3. **Active profile not propagating to voice sessions** — The API must fetch the active profile fresh from the database on every session start (no caching of profile content). Include `profileId` in session metadata so call logs record which profile version was used.

4. **npm workspace hoisting conflicts** — Pin React version in the dashboard `package.json` to match `apps/admin`. Test with a clean `npm install` after adding the workspace. Add `overrides` in root `package.json` if version conflicts arise.

5. **Split-brain from parallel VoiceAgentSettingsPage** — The existing admin panel page must be deprecated (redirect to `agent.coziyoo.com`) before the new dashboard goes live. Never run both UIs writing to the same table simultaneously.

## Implications for Roadmap

Based on the combined research, the architecture file's build order is the correct phase structure. The rationale is hard dependencies: the API must exist before the dashboard can display data; auth must work before any protected page can render; profile CRUD must exist before call logs can reference profiles; deployment must be configured before production traffic can reach the dashboard.

### Phase 1: Foundation — Database, API Routes, and Project Scaffolding

**Rationale:** The dashboard cannot display anything without API endpoints to call. Scaffolding the workspace and resolving operational concerns (CORS, npm hoisting, deployment strategy) in this phase prevents wasted debugging time during feature development.

**Delivers:** Working Next.js app shell with auth flow, all necessary API routes, two new database tables, and a verified deployment pipeline.

**Addresses:** Admin JWT authentication, project scaffolding, API client library

**Avoids:** CORS rejection (Pitfall 1), npm hoisting conflicts (Pitfall 6), deployment misconfiguration (Pitfall 9), missing CI/CD (Pitfall 12), JWT refresh race condition (Pitfall 2)

**Specific work:**
- Create `agent_profiles` table and `call_logs` table in Supabase
- Build `/v1/admin/agent-profiles` CRUD routes
- Build `/v1/admin/call-logs` read routes
- Modify `/v1/livekit/session/end` to write call_logs before N8N forward
- Update `getStarterAgentSettingsWithDefault()` to read from `agent_profiles WHERE is_active = TRUE`
- Scaffold `apps/voice-dashboard` workspace (Next.js 16, Tailwind v4, shadcn/ui)
- Implement login page, JWT storage, middleware redirect
- Port API client with JWT auto-refresh from `apps/admin/src/lib/api.ts`
- Configure layout with sidebar navigation
- Add dashboard origin to CORS defaults, update deploy scripts, create systemd service

### Phase 2: Profile Management — Core Feature

**Rationale:** Profile management is the entire reason the dashboard exists. Call logs are secondary and reference profiles, so profiles must exist first.

**Delivers:** Full profile CRUD with tabbed config editor, active profile toggle, and connection testing. Replaces all functionality of the existing `VoiceAgentSettingsPage`.

**Uses:** shadcn/ui Tabs + Card + Form, React Hook Form + Zod, TanStack Query mutations

**Implements:** Profile list page, profile create/edit form (Model | Voice | Transcriber | Tools tabs), activate/deactivate toggle, connection testing for STT/TTS/N8N/LiveKit

**Avoids:** Profile activation race condition (Pitfall 8 — partial unique index), split-brain from old page (Pitfall 7), active profile not propagating (Pitfall 3), App Router server component auth confusion (Pitfall 5)

**Specific work:**
- Profile list page with left-sidebar pattern
- Tabbed profile editor: Model (LLM config, system prompt, greeting), Voice (TTS servers), Transcriber (STT servers), Tools (N8N/webhook config)
- Activate/deactivate toggle with transaction-safe endpoint
- Connection testing UI for all providers (reuse existing test endpoints)
- Deprecate `VoiceAgentSettingsPage` in admin panel (add redirect)
- Migrate existing `starter_agent_settings` data to `agent_profiles`

### Phase 3: Call Logs — Monitoring

**Rationale:** Call logs require the profile data model to be stable (log entries reference profiles). This phase adds observability on top of a working profile management system.

**Delivers:** Paginated call log table with filtering, call log detail view, and aggregate stats.

**Implements:** TanStack Table + shadcn DataTable, date range filtering via nuqs URL state, profile linkage

**Avoids:** Unqueryable call log schema (Pitfall 4 — explicit columns and indexes already defined in schema design), LiveKit webhook confusion (Pitfall 11 — use agent-reported events via `/v1/livekit/session/end`)

**Specific work:**
- Call log list page with date range filter, profile filter, status filter
- Call log detail view
- Aggregate stats endpoint and dashboard overview card
- Abandoned session cleanup (mark sessions as abandoned if no end event within N minutes)

### Phase 4: Deployment and Cutover

**Rationale:** Deployment concerns are isolated to a final phase because the deployment strategy (static export vs Node.js server mode) is decided in Phase 1, but the actual production cutover happens after all features are verified locally.

**Delivers:** Production-ready dashboard at `agent.coziyoo.com` integrated with CI/CD.

**Specific work:**
- Finalize `next.config.ts` (standalone output vs static export)
- Systemd service file for `coziyoo-voice-dashboard`
- Nginx Proxy Manager rule: `agent.coziyoo.com -> 127.0.0.1:3001`
- Update `update_all.sh` with build step and service restart
- End-to-end production verification

### Phase Ordering Rationale

- Phase 1 before Phase 2: The profile form cannot save without API routes. Resolving CORS, hoisting, and deployment upfront eliminates an entire class of "why doesn't this work" debugging during feature development.
- Phase 2 before Phase 3: Call log records use `profile_id` as a foreign key. The profiles table and activation flow must be stable before call log ingestion begins.
- Phase 3 before Phase 4: Call logs need at least one real session cycle (profile active -> voice call -> session end -> log written) to verify the full data path before cutover.
- Old VoiceAgentSettingsPage deprecation happens during Phase 2, not after — the dashboard must fully replace the page before both exist simultaneously.

### Research Flags

Phases with standard patterns (research-phase not required):
- **Phase 1 scaffolding:** Next.js 16 + shadcn/ui initialization is well-documented; auth pattern is a direct port from `apps/admin`
- **Phase 2 profile CRUD:** REST CRUD with tabbed forms is a well-documented pattern; all API endpoints follow existing admin route conventions
- **Phase 4 deployment:** Systemd + Nginx pattern already exists for `coziyoo-admin`; this is the same pattern applied to a second Node.js service

Phases that may benefit from targeted research before planning:
- **Phase 3 call logs (aggregate stats):** The specific PostgreSQL window functions and query patterns for time-series aggregation (calls per day, rolling averages) may benefit from a quick reference check when designing the stats endpoint.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Next.js 16.2, shadcn/ui, TanStack Query — all verified against official release docs. Version compatibility matrix validated. Auth pattern verified from existing codebase source files. |
| Features | HIGH | Features cross-referenced against existing codebase (all table-stakes features have existing API endpoints or data), validated against vapi.ai reference screenshots, and cross-checked against PROJECT.md requirements. |
| Architecture | HIGH | Derived from direct analysis of existing codebase files (`admin-livekit.ts`, `starter-agent-settings.ts`, `entrypoint.py`). Schema design follows documented PostgreSQL best practices. No speculative assumptions. |
| Pitfalls | HIGH | Every pitfall identified is grounded in a specific file and line in the existing codebase, not general warnings. CORS defaults verified in `env.ts:20`, activation transaction verified in `admin-livekit.ts:494-505`, refresh token rotation in `admin-auth.ts`. |

**Overall confidence:** HIGH

### Gaps to Address

- **Static export vs Node.js server mode decision:** PITFALLS.md flags this as a Phase 1 decision because it determines whether App Router SSR features are available. Research suggests static export is viable and simplifies deployment, but the final call depends on whether Next.js middleware auth redirects are needed. Decide in Phase 1 before any routing code is written.

- **Abandoned session detection threshold:** PITFALLS.md recommends a cleanup job to mark sessions as "abandoned" if no end event arrives within N minutes. The correct value for N is not in the research — it depends on how long typical voice sessions last and what LiveKit's idle timeout is. Determine in Phase 3.

- **`schemaCapabilitiesPromise` caching scope:** PITFALLS.md flags that `starter-agent-settings.ts:51` has a singleton cache that could serve stale profile data. Research recommends verifying no other caching layer exists before the activation endpoint is considered safe. Verify during Phase 2 implementation.

## Sources

### Primary (HIGH confidence)
- [Next.js 16 release blog](https://nextjs.org/blog/next-16) — framework version and App Router defaults
- [Next.js 16.2 release blog](https://nextjs.org/blog/next-16-2) — latest stable (2026-03-21)
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) — component library setup
- [shadcn/cli v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) — Tailwind v4 + React 19 support
- [TanStack Query Advanced SSR guide](https://tanstack.com/query/v5/docs/react/guides/advanced-ssr) — App Router integration
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4) — CSS-first config
- Existing codebase: `apps/admin/src/lib/api.ts` — auth pattern (source of truth)
- Existing codebase: `apps/api/src/routes/admin-livekit.ts` — activation transaction, test endpoints
- Existing codebase: `apps/api/src/services/starter-agent-settings.ts` — caching pattern
- Existing codebase: `apps/voice-agent/src/voice_agent/entrypoint.py` — metadata consumption pattern
- Existing codebase: `apps/api/src/config/env.ts` — CORS defaults
- vapi.ai dashboard screenshots (`voice-dashboard-snaphots/`) — UX reference

### Secondary (MEDIUM confidence)
- [nuqs - Type-safe search params](https://nuqs.dev) — URL state for filters
- [Vapi Assistant API Reference](https://docs.vapi.ai/api-reference/assistants/create) — feature reference
- [Retell AI Review 2026](https://www.retellai.com/blog/vapi-ai-review) — competitive feature landscape

### Tertiary (LOW confidence)
- N/A — no low-confidence sources relied upon for roadmap decisions

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
