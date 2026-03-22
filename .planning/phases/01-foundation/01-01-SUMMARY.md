---
phase: 01-foundation
plan: 01
subsystem: ui
tags: [nextjs, shadcn-ui, cors, monorepo, workspace]
requires: []
provides:
  - "Buildable apps/voice-dashboard Next.js workspace integrated into npm workspaces"
  - "Shared auth-ready types (AdminUser, Tokens, ApiError) for upcoming dashboard auth work"
  - "CORS defaults updated for localhost:3001 and agent.coziyoo.com across config sources"
affects: [phase-01-plan-02-auth, phase-01-plan-03-deployment]
tech-stack:
  added: [nextjs-16, react-19, shadcn-ui, sonner, tailwindcss-4]
  patterns: [standalone-next-output, dev-rewrite-proxy, centralized-cors-defaults]
key-files:
  created:
    - apps/voice-dashboard/package.json
    - apps/voice-dashboard/next.config.ts
    - apps/voice-dashboard/src/lib/types.ts
    - apps/voice-dashboard/src/components/ui/sonner.tsx
  modified:
    - package.json
    - package-lock.json
    - apps/api/src/config/env.ts
    - .env.example
    - installation/scripts/common.sh
key-decisions:
  - "Kept dashboard API calls same-origin in development using Next rewrites to localhost:3000."
  - "Retained standalone Next output to align with production service model and later deployment plan."
  - "Added production dashboard origin through VOICE_DASHBOARD_DOMAIN default in deployment env generation."
patterns-established:
  - "Workspace-first app scaffolding: app lives under apps/* and is wired through root scripts/workspaces."
  - "CORS defaults must be synchronized in env schema, sample env, and deployment shell defaults."
requirements-completed: [APP-01]
duration: 6min
completed: 2026-03-22
---

# Phase 1 Plan 1: Foundation Summary

**Next.js voice-dashboard workspace with shadcn/ui baseline and CORS defaults aligned for both localhost:3001 and agent.coziyoo.com.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-22T12:58:28Z
- **Completed:** 2026-03-22T13:04:24Z
- **Tasks:** 2
- **Files modified:** 32

## Accomplishments
- Scaffolded `apps/voice-dashboard` as a buildable Next.js 16 workspace with port `3001` dev script.
- Added shared dashboard types (`AdminUser`, `Tokens`, `ApiError`) and placeholder root page/layout metadata.
- Initialized shadcn/ui components (`button`, `card`, `input`, `label`, `sonner`) and fixed resulting build blockers.
- Updated API/app/deploy CORS defaults to include dashboard dev and production origins.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next.js workspace and configure monorepo integration** - `4a1cc0c` (feat), `a519421` (fix follow-up)
2. **Task 2: Fix CORS defaults across all configuration sources** - `b28819d` (fix)

_Note: Task 1 required a follow-up fix commit to correct a nested git repository artifact from scaffolding._

## Files Created/Modified
- `apps/voice-dashboard/*` - New Next.js workspace, shadcn components, and baseline app shell.
- `package.json` - Added workspace and root scripts for voice-dashboard.
- `package-lock.json` - Updated dependency graph for new workspace and UI deps.
- `apps/api/src/config/env.ts` - Added `localhost:3001` to default CORS origins.
- `.env.example` - Added `localhost:3001` and `https://agent.coziyoo.com` sample CORS origins.
- `installation/scripts/common.sh` - Added `VOICE_DASHBOARD_DOMAIN` and extended CORS defaults.

## Decisions Made
- Used Next.js rewrites (`/v1/:path* -> localhost:3000`) for low-friction local API integration.
- Kept minimal placeholder UI as requested; authentication flow deferred to Plan 02.
- Preserved deployment script structure while only extending default origin values.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] shadcn initialization produced unresolved CSS imports**
- **Found during:** Task 1
- **Issue:** Build failed on missing `tw-animate-css` and invalid `shadcn/tailwind.css` resolution.
- **Fix:** Installed `tw-animate-css` and removed invalid `shadcn/tailwind.css` import from `globals.css`.
- **Files modified:** `apps/voice-dashboard/src/app/globals.css`, `apps/voice-dashboard/package.json`, `package-lock.json`
- **Verification:** `npm run build --workspace=apps/voice-dashboard` passed.
- **Committed in:** `4a1cc0c`

**2. [Rule 3 - Blocking] shadcn component dependencies/types incomplete**
- **Found during:** Task 1
- **Issue:** Missing UI dependencies and `Slot` type mismatch blocked TypeScript build.
- **Fix:** Added required UI deps and switched button slot import to `@radix-ui/react-slot`.
- **Files modified:** `apps/voice-dashboard/package.json`, `apps/voice-dashboard/src/components/ui/button.tsx`, `package-lock.json`
- **Verification:** `npm run build --workspace=apps/voice-dashboard` passed.
- **Committed in:** `4a1cc0c`

**3. [Rule 3 - Blocking] create-next-app generated nested git repository**
- **Found during:** Task 1 commit
- **Issue:** `apps/voice-dashboard` was added as gitlink (`160000`) instead of regular files.
- **Fix:** Removed nested `.git` metadata and recommitted workspace files as normal repository content.
- **Files modified:** `apps/voice-dashboard/*`
- **Verification:** `git ls-files apps/voice-dashboard` lists regular tracked files, not submodule gitlink.
- **Committed in:** `a519421`

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All fixes were required for build correctness and repository integrity; no scope creep.

## Issues Encountered
- `create-next-app` initialized an inner git repo by default, which required immediate correction to preserve monorepo file tracking.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Voice dashboard scaffold is buildable and integrated into the workspace.
- CORS defaults are aligned for upcoming auth/API calls from both dev and production dashboard origins.
- Plan 02 can now focus purely on authentication behavior and route protection.

## Self-Check: PASSED
- FOUND: `.planning/phases/01-foundation/01-01-SUMMARY.md`
- FOUND: `4a1cc0c`
- FOUND: `a519421`
- FOUND: `b28819d`
