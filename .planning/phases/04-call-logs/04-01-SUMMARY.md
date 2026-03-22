---
phase: 04-call-logs
plan: 01
subsystem: api
tags: [fastapi, express, postgres, call-logs, livekit]
requires:
  - phase: 02-profile-management
    provides: agent_profiles table and admin auth boundary
provides:
  - Session-end call persistence in API
  - Admin call-log list endpoint with filters
  - API tests for persistence and filtering
affects: [dashboard, voice-agent, monitoring]
tech-stack:
  added: []
  patterns: [api-side persistence before webhook forwarding, filtered admin list endpoints]
key-files:
  created:
    - apps/api/src/db/migrations/0015_agent_call_logs.sql
    - apps/api/src/routes/admin-agent-call-logs.ts
    - apps/api/src/routes/__tests__/livekit-session-end-logs.test.ts
    - apps/api/src/routes/__tests__/admin-agent-call-logs.test.ts
  modified:
    - apps/api/src/routes/livekit.ts
    - apps/api/src/app.ts
key-decisions:
  - "Persist session-end rows inside /v1/livekit/session/end before n8n forwarding so internal logs are durable."
  - "Keep profile_id nullable and resolved from profileId or metadata.settingsProfileId to support legacy/partial payloads."
patterns-established:
  - "Admin list endpoints accept profileId/from/to plus limit/offset filters."
requirements-completed: [LOGS-01, LOGS-02, LOGS-03, LOGS-04]
duration: 20min
completed: 2026-03-22
---

# Phase 4 Plan 01: Call Logs Summary

**Session-end events now persist into `agent_call_logs`, and admins can query filtered call history via `/v1/admin/agent-call-logs`.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-03-22T20:01:00Z
- **Completed:** 2026-03-22T20:03:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added `agent_call_logs` schema migration with profile/time indexes.
- Extended `/v1/livekit/session/end` to compute duration and persist records with profile linkage.
- Added authenticated admin call-log listing endpoint with profile/date/pagination filters.
- Added focused API tests for persistence/auth/filter behaviors.

## Task Commits

1. **Task 1: Add call log schema + persistence** - `913b877` (feat)
2. **Task 2: Add admin call-log list endpoint** - `4a6a762` (feat)

## Files Created/Modified
- `apps/api/src/db/migrations/0015_agent_call_logs.sql` - call log table + indexes
- `apps/api/src/routes/livekit.ts` - session-end persistence logic
- `apps/api/src/routes/admin-agent-call-logs.ts` - filtered admin list route
- `apps/api/src/routes/__tests__/livekit-session-end-logs.test.ts` - persistence/auth tests
- `apps/api/src/routes/__tests__/admin-agent-call-logs.test.ts` - route/filter tests
- `apps/api/src/app.ts` - route mount under admin auth

## Decisions Made
- Persist logs before n8n webhook forwarding so webhook instability does not erase local observability.
- Filter validation is strict (`profileId` uuid, `from`/`to` datetime) at API boundary.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Backend contract is ready for dashboard call-log UI integration and URL-persistent filtering.

