# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-12)

**Core value:** Buyer opens mobile app, speaks to AI agent, and their order is placed — no tapping required.
**Current focus:** Phase 4 — Per-Turn N8N Integration

## Current Position

Phase: 4 (Per-Turn N8N Integration)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-03-16 — Plans 04-01, 04-02, 04-03 complete; n8n error handling improved, HTTP errors re-raise without fallback

Progress: [██░░░░░░░░] 20%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: ~3m
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 4 | 3 | 7m | 2m |

**Recent Trend:**
- Last 5 plans: 04-01, 04-02, 04-03
- Trend: Fast (mostly pre-implemented)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Supabase cutover: Twin DB copy already exists; env var swap only — no code changes needed for DB-01
- n8n as LLM brain: Per-turn synchronous calls via webhook; "Respond to Webhook" node required to avoid 60s timeout
- Phase ordering: DB cutover is gate for everything else; log viewer fixed before n8n chain debugging
- Re-raise APIStatusError immediately without execution API fallback — n8n HTTP errors indicate webhook reachability issues the fallback cannot resolve
- Log raw n8n response body (500 chars) before raising empty-answer error to aid operator diagnosis of missing respondToWebhook node

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 4 (n8n Order Creation): n8n workflow configuration is external to codebase; needs hands-on inspection before planning
- Phase 7 (User Memory): No memory persistence schema exists yet; needs design step before planning
- Phase 8 (Lots in Foods): Completed 2026-03-15; LOTS-01 through LOTS-05 implemented
- iOS physical device behavior (Phase 2): AudioSession code is correct in source but untested on physical hardware
- React Native New Architecture + LiveKit (Phase 2): Active open issue #305; must test on device

## Session Continuity

Last session: 2026-03-16
Stopped at: Completed 04-03-PLAN.md (n8n webhook error handling)
Resume file: None
