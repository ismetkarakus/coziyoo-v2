---
phase: 01-foundation
plan: 03
subsystem: infra
tags: [deployment, systemd, nextjs, ci-cd, scripts]
requires:
  - phase: 01-foundation
    provides: "Voice dashboard scaffold and deployment defaults from 01-01"
provides:
  - "Voice dashboard install script with systemd unit creation"
  - "Voice dashboard update script for build and restart flow"
  - "Deployment orchestration integration via update_all.sh and run_all.sh"
affects: [deployment, operations, ci-cd]
tech-stack:
  added: []
  patterns: ["Bash deploy scripts modeled after existing admin panel deploy pattern"]
key-files:
  created:
    - installation/scripts/install_voice_dashboard.sh
    - installation/scripts/update_voice_dashboard.sh
  modified:
    - installation/scripts/update_all.sh
    - installation/scripts/run_all.sh
key-decisions:
  - "Deploy dashboard as Next.js standalone systemd service named coziyoo-voice-dashboard on port 3001."
  - "Run dashboard update after admin update and before voice-agent update in update_all.sh."
patterns-established:
  - "New app deployment scripts mirror install/update_admin_panel.sh conventions."
  - "Service aliases in run_all.sh map friendly names to configurable *_SERVICE_NAME env vars."
requirements-completed: [APP-02, APP-03]
duration: 10min
completed: 2026-03-22
---

# Phase 01 Plan 03: Voice Dashboard Deployment Pipeline Summary

**Voice dashboard now deploys automatically via update_all.sh using a dedicated Next.js standalone systemd service and script orchestration hooks.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-22T13:30:09Z
- **Completed:** 2026-03-22T13:39:07Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- Added first-time install automation for voice dashboard (`install_voice_dashboard.sh`) with systemd unit generation.
- Added update automation for voice dashboard (`update_voice_dashboard.sh`) with build, static asset copy, and service restart.
- Integrated dashboard service lifecycle and deploy order into `update_all.sh` and `run_all.sh`.
- Completed human verification checkpoint with explicit approval.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create install and update scripts for voice dashboard deployment** - `960cdf9` (feat)
2. **Task 2: Integrate voice dashboard into update_all.sh and run_all.sh** - `83554e2` (feat)
3. **Task 3: Verify deployment scripts are correct** - Human checkpoint approved (no code changes)

## Files Created/Modified
- `installation/scripts/install_voice_dashboard.sh` - Builds Next.js dashboard and provisions `coziyoo-voice-dashboard` systemd unit.
- `installation/scripts/update_voice_dashboard.sh` - Rebuilds dashboard, copies standalone assets, restarts service.
- `installation/scripts/update_all.sh` - Stops and updates dashboard during full deployment in the correct order.
- `installation/scripts/run_all.sh` - Adds `voice-dashboard` service alias for start/stop/restart/status/logs.

## Decisions Made
- Used Next.js standalone `node server.js` runtime for systemd parity with existing deploy scripts.
- Kept deployment integration inside existing `update_all.sh` flow to preserve GitHub Actions contract without workflow changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `git pull --rebase --autostash` on `main` hit unrelated historical conflicts outside this plan scope. Execution continued on branch `gsd/01-foundation-03-execute` and only plan-scoped files were committed.

## User Setup Required

- Verify/ensure Nginx Proxy Manager mapping: `agent.coziyoo.com -> 127.0.0.1:3001`.

## Next Phase Readiness

- Voice dashboard deployment scripts are ready for production use via existing CI/CD path.
- Foundation phase planning state can advance after metadata updates.

---
*Phase: 01-foundation*
*Completed: 2026-03-22*

## Self-Check: PASSED

- Found summary file at `.planning/phases/01-foundation/01-03-SUMMARY.md`
- Found task commit `960cdf9`
- Found task commit `83554e2`
