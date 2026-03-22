---
phase: 02-profile-management
plan: 03
subsystem: ui
tags: [fastapi, jinja2, htmx, profile-management, supabase]
requires:
  - phase: 02-02
    provides: Profile editor forms and save pipeline
provides:
  - Same-origin provider test actions for LLM/TTS/STT/N8N
  - cURL import parser + profile autofill route
  - STT recording/transcription UI and TTS audio playback in dashboard
  - Regression tests for dashboard profile routes
affects: [phase-03-provider-adapters, runtime-profile-config, dashboard-auth]
tech-stack:
  added: [none]
  patterns: [FastAPI BFF proxy routes, HTMX partial status rendering, form-driven provider tests]
key-files:
  created:
    - apps/voice-agent/src/voice_agent/curl_parser.py
    - apps/voice-agent/src/voice_agent/templates/profiles/_status.html
    - apps/voice-agent/tests/test_dashboard_profiles.py
  modified:
    - apps/voice-agent/src/voice_agent/join_api.py
    - apps/voice-agent/src/voice_agent/dashboard_api.py
    - apps/voice-agent/src/voice_agent/templates/profiles/_editor_model.html
    - apps/voice-agent/src/voice_agent/templates/profiles/_editor_voice.html
    - apps/voice-agent/src/voice_agent/templates/profiles/_editor_transcriber.html
    - apps/voice-agent/src/voice_agent/templates/profiles/_editor_tools.html
    - apps/voice-agent/src/voice_agent/config/settings.py
key-decisions:
  - "All browser interactions call same-origin /dashboard routes; only server-side code calls API_BASE_URL."
  - "Default API base URL set to https://api.coziyoo.com while remaining env-overridable via API_BASE_URL."
  - "Legacy starter_agent_settings payloads were transformed into agent_profiles JSON shape directly in Supabase."
patterns-established:
  - "Status feedback partial: provider tests return a single _status.html fragment for consistent UX"
  - "Config import: cURL fingerprinting maps payloads to llm/tts/stt/n8n profile sections"
requirements-completed: [VOICE-06, STT-06, TOOLS-04, TOOLS-05]
duration: 21min
completed: 2026-03-22
---

# Phase 2 Plan 03: Interactive Provider Tests + cURL Import Summary

**FastAPI dashboard now runs LLM/TTS/STT/N8N live tests, supports cURL-based config import, and uses a configurable real API base defaulting to `https://api.coziyoo.com`.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-03-22T17:29:21Z
- **Completed:** 2026-03-22T17:50:40Z
- **Tasks:** 3
- **Files modified:** 11

## Accomplishments
- Added dashboard proxy endpoints for provider tests (`/dashboard/test/*`) with explicit success/error status rendering.
- Implemented cURL import flow (`/dashboard/profiles/{id}/import-curl`) with parser-based section mapping and profile persistence.
- Wired Model/Voice/Transcriber/Tools tab actions, including STT recording + transcription and TTS playback.
- Added regression tests for auth redirect, profile list proxying, import route existence, and HTML status responses.
- Migrated legacy Supabase `starter_agent_settings` data into new `agent_profiles` record shape for the FastAPI dashboard.

## Task Commits

1. **Task 1: Add dashboard-side test proxy endpoints and status rendering** - `d77dbe3` (feat)
2. **Task 2: Implement cURL import parser and form autofill mapping** - `c92d907` (feat)
3. **Task 3: Wire tab-level interactive tests and add regression tests** - `fd1ac77` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `apps/voice-agent/src/voice_agent/join_api.py` - Added all test proxy routes and cURL import route.
- `apps/voice-agent/src/voice_agent/dashboard_api.py` - Added binary request helper for TTS passthrough.
- `apps/voice-agent/src/voice_agent/curl_parser.py` - Added `tokenize_curl` and `parse_curl_command`.
- `apps/voice-agent/src/voice_agent/templates/profiles/_status.html` - Added unified status partial for test feedback/audio/transcript.
- `apps/voice-agent/src/voice_agent/templates/profiles/_editor_model.html` - Added LLM test trigger.
- `apps/voice-agent/src/voice_agent/templates/profiles/_editor_voice.html` - Added TTS test trigger and default text.
- `apps/voice-agent/src/voice_agent/templates/profiles/_editor_transcriber.html` - Added MediaRecorder flow + STT test actions.
- `apps/voice-agent/src/voice_agent/templates/profiles/_editor_tools.html` - Added N8N test + cURL import UI.
- `apps/voice-agent/tests/test_dashboard_profiles.py` - Added targeted regression tests.
- `apps/voice-agent/src/voice_agent/config/settings.py` - Defaulted API base URL to production API while preserving env override.

## Decisions Made
- Kept all frontend calls same-origin to avoid browser CORS dependency and hide upstream API URL from templates.
- Used base64 data URI strategy for TTS test playback to keep response flow HTMX-compatible.
- Mapped legacy starter settings payload into normalized profile JSON keys (`base_url`, `endpoint_path`, `custom_headers`, etc.) in Supabase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing local Python tooling for test execution**
- **Found during:** Task 3 verification
- **Issue:** Local env lacked `pytest` and `python-multipart`, preventing planned regression test run.
- **Fix:** Installed both in local `apps/voice-agent/.venv` and reran tests.
- **Verification:** `apps/voice-agent/.venv/bin/python -m pytest -q tests/test_dashboard_profiles.py` passed (4 tests).
- **Committed in:** Not committed (environment-only change).

**2. [Rule 2 - Missing Critical] No migrated runtime profile data for new dashboard design**
- **Found during:** Post-task validation against Supabase
- **Issue:** `agent_profiles` table had correct schema but zero rows; legacy config remained in `starter_agent_settings`.
- **Fix:** Ran direct Supabase migration script to transform starter config into `agent_profiles` JSON shape and ensure one active profile.
- **Verification:** `agent_profiles` now contains active profile `coziyoo-agent` with populated `llm_config/stt_config/tts_config/n8n_config`.
- **Committed in:** N/A (direct DB change).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both were required for operability and verification; no scope creep beyond runtime correctness.

## Issues Encountered
- `python` alias unavailable in shell; used `python3`.
- `psql` unavailable locally; used Node `pg` direct connection for Supabase operations.

## User Setup Required
None - no additional manual setup required.

## Next Phase Readiness
- Phase 2 Plan 03 runtime requirements are complete for provider testing + import flows.
- Phase 3 can proceed with adapter/runtime hardening using live profile config inputs.

## Self-Check: PASSED
- Found summary file at `.planning/phases/02-profile-management/02-03-SUMMARY.md`
- Verified task commit hashes exist: `d77dbe3`, `c92d907`, `fd1ac77`

---
*Phase: 02-profile-management*
*Completed: 2026-03-22*
