---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-03-22T18:38:06.858Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 11
  completed_plans: 9
---

# Project State: Voice Agent Dashboard

## Project Reference

**Core Value:** The team can switch between fully-configured voice agent profiles instantly -- tuning model, voice, transcriber, and tools -- without touching code or redeploying the agent.

**Current Focus:** Phase 03 — provider-adapter-system (completed)

## Current Position

Phase: 03 (provider-adapter-system) — COMPLETE
Plan: 3 of 3 (03-03 completed)

## Performance Metrics

| Metric | Value |
|--------|-------|
| Plans completed | 9 |
| Plans failed | 0 |
| Total requirements | 45 |
| Requirements done | 41 |
| Phases complete | 2/4 |
| Phase 01-foundation P01 | 6m | 2 tasks | 32 files |
| Phase 01-foundation P03 | 10min | 3 tasks | 4 files |
| Phase 01-foundation P02 | 4min | 2 tasks | 8 files |
| Phase 01-foundation P05 | 2min | 2 tasks | 2 files |
| Phase 01-foundation P04 | 2min | 2 tasks | 3 files |
| Phase 02-profile-management P01 | 5m | 2 tasks | 3 files |
| Phase 02-profile-management P02 | 11m | 2 tasks | 28 files |
| Phase 02-profile-management P03 | 7min | 2 tasks | 10 files |
| Phase 02-profile-management P05 | 5min | 2 tasks | 5 files |
| Phase 02-profile-management P03 | 21min | 3 tasks | 11 files |
| Phase 03-provider-adapter-system P01 | 18min | 2 tasks | 4 files |
| Phase 03-provider-adapter-system P02 | 32min | 2 tasks | 7 files |
| Phase 03-provider-adapter-system P03 | 20min | 1 tasks | 2 files |

## Accumulated Context

### Key Decisions

- Granularity: coarse (4 phases)
- Phase 1 includes deployment setup (APP-01, APP-02, APP-03) so scaffold is deployable from day one
- Provider adapter work (ADAPT-*) is Python voice agent changes, separate from dashboard UI
- Phase 3 and Phase 4 are independent -- can be done in either order after Phase 2
- DB schema changes applied directly to Supabase -- no migration files
- Used Next.js rewrites for dashboard API proxy in development.
- Kept standalone Next output for deployment compatibility.
- Added VOICE_DASHBOARD_DOMAIN-backed CORS default for production origin.
- Deployed voice dashboard as Next.js standalone systemd service (`coziyoo-voice-dashboard`) on port 3001.
- Integrated dashboard stop/update flow into `update_all.sh` and `run_all.sh` via `voice-dashboard` alias.
- Used dashboard-specific sessionStorage keys to isolate voice-dashboard auth sessions from admin panel sessions.
- Kept serialized refresh-in-flight token rotation on 401 to avoid concurrent refresh races in dashboard API calls.
- Kept CORS fallback fix scoped to env default string plus targeted regression coverage.
- Mocked dotenv in env fallback test to guarantee deterministic fallback assertions.
- Used explicit /dashboard route as authenticated landing target to avoid root/login redirect loop.
- Kept logout behavior unchanged in dashboard UI: `await logout(); router.push("/login")`.
- Mounted `/v1/admin/agent-profiles` behind `requireAuth("admin")` and isolated handler logic in a dedicated router.
- Preserved provider flexibility by storing profile provider settings in JSONB (`llm_config`, `stt_config`, `tts_config`, `n8n_config`).
- Enforced exclusive active profile switching with transaction (`BEGIN` → clear active → set target active → `COMMIT`).
- Kept profile data flow in TanStack Query hooks and invalidated list/detail keys after mutations.
- Implemented `/profiles` as a redirecting index page so sidebar remains the single navigation source.
- Stabilized generated shadcn/Radix typing by normalizing imports and intrinsic prop typing to pass Next build.
- Kept profile config in a single RHF instance and delegated all tab content to dedicated Model/Voice/Transcriber/Tools components.
- Centralized STT/TTS/N8N connectivity actions in a shared `useConnectionTest` hook for consistent status handling.
- Mapped cURL import payloads to LLM/TTS/STT/N8N sections using URL/path fingerprint heuristics.
- Kept `/test/llm` failures as explicit `502` + `LLM_TEST_FAILED` payloads for deterministic dashboard feedback.
- Used form-sourced `llm_config` overrides (base URL, endpoint path, headers, body params) directly in LLM test requests.
- Enforced same-origin dashboard test calls (`/dashboard/test/*`) so browser never calls upstream API directly.
- Set `API_BASE_URL` default to `https://api.coziyoo.com` while retaining env override for quick switching.
- Migrated legacy `starter_agent_settings` records into normalized `agent_profiles` JSON shape in Supabase.

### Research Findings Applied

- Next.js 16.2 App Router + shadcn/ui + TanStack Query confirmed as stack
- Auth pattern is a direct port from apps/admin (JWT auto-refresh)
- CORS config must be resolved in Phase 1 before any feature work
- Existing VoiceAgentSettingsPage deprecated during Phase 2 (not after)
- Python voice agent needs zero changes for Phase 1-2 -- config propagation already works via metadata injection

### Todos

- (none yet)

### Blockers

- (none)

## Session Continuity

**Last session:** 2026-03-22T18:38:06.856Z
**Next action:** Execute Phase 04 (call logs) starting with 04-01-PLAN.md.

---
*State initialized: 2026-03-22*
*Last updated: 2026-03-22*
