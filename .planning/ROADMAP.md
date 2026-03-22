# Roadmap: Voice Agent Dashboard

**Created:** 2026-03-22
**Granularity:** Coarse (4 phases)
**Coverage:** 45/45 v1 requirements mapped

## Phases

- [x] **Phase 1: Foundation** - DB schema, API routes, CORS config, deployment pipeline (Next.js scaffold superseded — see Phase 2 pivot)
- [ ] **Phase 2: Profile Management** - FastAPI+HTMX dashboard served from voice-agent: profile CRUD, 4-tab config editor (Model|Voice|Transcriber|Tools), activation toggle, connection testing, cURL import
- [ ] **Phase 3: Provider Adapter System** - OpenAI-compatible base client in Python voice agent, service-specific adapters with header/body/path/field overrides
- [ ] **Phase 4: Call Logs** - Call session persistence, log viewer with date and profile filtering

## Phase Details

### Phase 1: Foundation
**Goal**: The dashboard app exists, authenticates users, and is deployable -- all infrastructure is in place before feature development begins
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, APP-01, APP-02, APP-03
**Success Criteria** (what must be TRUE):
  1. User can navigate to agent.coziyoo.com/login, enter admin credentials, and land on an authenticated dashboard shell
  2. User session survives page refresh and auto-refreshes expired JWTs without requiring re-login
  3. User can log out and is redirected to the login page, with no authenticated routes accessible
  4. The dashboard builds and deploys via the existing CI/CD pipeline (push to main triggers deploy to VPS)
  5. The API accepts requests from the dashboard origin without CORS errors (both localhost dev and production domain)
**Plans:** 5 plans
Plans:
- [x] 01-01-PLAN.md -- Scaffold Next.js workspace and fix CORS defaults
- [x] 01-02-PLAN.md -- Implement admin JWT auth (login, token refresh, logout)
- [x] 01-03-PLAN.md -- Create deployment pipeline (systemd, install/update scripts, CI/CD integration)
- [x] 01-04-PLAN.md -- Gap closure: fix reachable post-login dashboard routing and logout accessibility
- [x] 01-05-PLAN.md -- Gap closure: align API fallback CORS default with dashboard production origin + regression test

### Phase 2: Profile Management
**Goal**: Users can create, configure, and activate voice agent profiles through a FastAPI+HTMX dashboard served directly from the voice-agent Python app -- apps/voice-dashboard (Next.js) has been removed
**Depends on**: Phase 1 (agent_profiles DB table + CRUD API routes remain valid)
**Requirements**: PROF-01, PROF-02, PROF-03, PROF-04, PROF-05, PROF-06, MODEL-01, MODEL-02, MODEL-03, MODEL-04, MODEL-05, MODEL-06, MODEL-07, VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06, STT-01, STT-02, STT-03, STT-04, STT-05, STT-06, TOOLS-01, TOOLS-02, TOOLS-03, TOOLS-04, TOOLS-05
**Tech Stack**: Python FastAPI + Jinja2 templates + HTMX (no React, no Next.js)
**Success Criteria** (what must be TRUE):
  1. User can navigate to the dashboard URL, log in with admin credentials, and land on an authenticated profile list page
  2. User can create a named profile, see it appear in the left sidebar, and click it to open a 4-tab editor (Model | Voice | Transcriber | Tools)
  3. User can fill out all config fields across all four tabs (base URLs, API keys, custom headers, custom body params, endpoint paths, system prompt, greeting, voice ID, language, webhook URLs) and save -- values persist on page reload
  4. User can mark a profile as active, see the visual indicator in the sidebar, and verify that the next voice call uses that profile's config
  5. User can clone a profile, delete a non-active profile (with confirmation), and import server config by pasting a cURL command
  6. User can test connectivity for each provider (LLM, TTS, STT, N8N) from the dashboard and see success/failure feedback
**Plans**: TBD

### Phase 3: Provider Adapter System
**Goal**: The Python voice agent uses a unified OpenAI-compatible client with pluggable adapters, so dashboard config overrides (custom headers, body params, endpoint paths) actually take effect at runtime
**Depends on**: Phase 2
**Requirements**: ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04, ADAPT-05
**Success Criteria** (what must be TRUE):
  1. Voice agent makes all LLM, TTS, and STT requests through a single OpenAI-compatible base client (base URL + API key + model name)
  2. Custom headers configured in a dashboard profile are injected into the outgoing provider request at call time
  3. Custom body params and endpoint path overrides configured in a dashboard profile are applied to the outgoing provider request
  4. Non-OpenAI providers that return different response shapes have their fields remapped transparently -- the agent code does not branch on provider type
**Plans:** 3 plans
Plans:
- [ ] 03-01-PLAN.md -- Wave 0: pytest infrastructure + test stubs for all ADAPT requirements
- [ ] 03-02-PLAN.md -- Adapter module: Pydantic config models, factory functions (build_llm/tts/stt), response remapping
- [ ] 03-03-PLAN.md -- Entrypoint wiring: refactor _build_* functions to delegate to adapter module

### Phase 4: Call Logs
**Goal**: Users can see what happened with past voice sessions -- which profile was used, how long the call lasted, and whether it succeeded
**Depends on**: Phase 2 (profiles must exist for log entries to reference)
**Requirements**: LOGS-01, LOGS-02, LOGS-03, LOGS-04
**Success Criteria** (what must be TRUE):
  1. When a voice session ends, a log entry is automatically written to the database with the profile ID, start time, duration, and outcome
  2. User can view a table of past call sessions in the dashboard, sorted by date, showing duration, profile used, and outcome
  3. User can filter the call log table by profile and by date range, and filters persist in the URL
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 5/5 | Complete | 2026-03-22 (DB schema, API routes, CORS, deploy) |
| 2. Profile Management | 0/? | Not started | Pivoted to FastAPI+HTMX — replanning |
| 3. Provider Adapter System | 0/3 | Not started | - |
| 4. Call Logs | 0/? | Not started | - |

## Dependencies

```
Phase 1 (Foundation)
  |
  v
Phase 2 (Profile Management)
  |         \
  v          v
Phase 3    Phase 4
(Adapters)  (Call Logs)
```

Phase 3 and Phase 4 are independent of each other but both depend on Phase 2. Phase 3 depends on Phase 2 because the adapter system must consume the profile config schema that Phase 2 defines. Phase 4 depends on Phase 2 because call logs reference profile IDs.

---
*Roadmap created: 2026-03-22*
*Last updated: 2026-03-22*
