---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [nextjs, jwt, sessionstorage, sonner, shadcn-ui]
requires:
  - phase: 01-01
    provides: Next.js voice-dashboard scaffold, App Router structure, and shared UI primitives
provides:
  - Dashboard auth storage with isolated session keys
  - API request wrapper with serialized token refresh and logout helper
  - Login page with API integration and error toasts
  - Route guard and protected dashboard shell with logout flow
affects: [phase-02-settings-ui, phase-03-api-integration, auth]
tech-stack:
  added: []
  patterns: [admin-auth-port, serialized-refresh-on-401, client-route-guard]
key-files:
  created:
    - apps/voice-dashboard/src/lib/api.ts
    - apps/voice-dashboard/src/lib/auth.ts
    - apps/voice-dashboard/src/app/login/page.tsx
    - apps/voice-dashboard/src/components/auth-guard.tsx
    - apps/voice-dashboard/src/app/(dashboard)/layout.tsx
    - apps/voice-dashboard/src/app/(dashboard)/page.tsx
  modified:
    - apps/voice-dashboard/src/app/page.tsx
    - apps/voice-dashboard/src/app/layout.tsx
key-decisions:
  - "Used dashboard-specific sessionStorage keys to avoid collision with admin panel sessions."
  - "Kept serialized refresh-in-flight pattern from admin to prevent concurrent refresh races."
patterns-established:
  - "Auth Pattern: all dashboard API calls go through request() with single retry after refresh."
  - "Protection Pattern: authenticated app routes are wrapped by AuthGuard in (dashboard) layout."
requirements-completed: [AUTH-01, AUTH-02, AUTH-03]
duration: 4min
completed: 2026-03-22
---

# Phase 01 Plan 02: Admin Auth Summary

**JWT login with dashboard-isolated sessionStorage keys, serialized refresh-on-401 API client, and protected dashboard/logout flow in Next.js App Router**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T13:40:10Z
- **Completed:** 2026-03-22T13:44:17Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Ported admin auth storage + API refresh client into voice-dashboard with `NEXT_PUBLIC_API_BASE_URL`.
- Implemented `/login` page with credential submit, token/admin persistence, and Sonner error toast handling.
- Added `AuthGuard`, protected `(dashboard)` layout, and dashboard home logout path that clears session and redirects.

## Task Commits

Each task was committed atomically:

1. **Task 1: Port auth library and API client from admin panel** - `9d493c9` (feat)
2. **Task 2: Build login page, auth guard, dashboard layout, and logout** - `9ecb775` (feat)

## Files Created/Modified
- `apps/voice-dashboard/src/lib/auth.ts` - Session storage helpers for tokens/admin with dashboard-scoped keys.
- `apps/voice-dashboard/src/lib/api.ts` - Request wrapper with auth header injection, serialized refresh, and logout.
- `apps/voice-dashboard/src/app/login/page.tsx` - Client login form posting to `/v1/admin/auth/login`.
- `apps/voice-dashboard/src/components/auth-guard.tsx` - Client-side route gate redirecting unauthenticated users to `/login`.
- `apps/voice-dashboard/src/app/(dashboard)/layout.tsx` - Protected dashboard shell wrapper using `AuthGuard`.
- `apps/voice-dashboard/src/app/(dashboard)/page.tsx` - Welcome view with logout button.
- `apps/voice-dashboard/src/app/page.tsx` - Root redirect to `/login`.
- `apps/voice-dashboard/src/app/layout.tsx` - Global `Toaster` mount.

## Decisions Made
- Isolated dashboard token/admin storage keys from admin app keys to prevent cross-app session collision.
- Preserved the admin app refresh serialization behavior for stability under concurrent 401 responses.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Dashboard auth gate is fully wired and ready for authenticated settings/config pages in subsequent phases.

## Self-Check: PASSED
- FOUND: `.planning/phases/01-foundation/01-02-SUMMARY.md`
- FOUND: `9d493c9`
- FOUND: `9ecb775`
