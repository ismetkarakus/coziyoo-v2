# Requirements: Voice Agent Dashboard

**Defined:** 2026-03-22
**Core Value:** The team can switch between fully-configured voice agent profiles instantly — tuning model, voice, transcriber, and tools — without touching code or redeploying the agent.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Authentication

- [x] **AUTH-01**: User can log in with admin credentials (email/password) at agent.coziyoo.com/login
- [x] **AUTH-02**: User session persists and auto-refreshes JWT on 401 (same pattern as admin panel)
- [x] **AUTH-03**: User can log out and is redirected to login page

### Profile Management

- [ ] **PROF-01**: User can create a named agent profile
- [ ] **PROF-02**: User can view all profiles in a left sidebar list
- [ ] **PROF-03**: User can delete a profile (with confirmation, cannot delete the active profile)
- [ ] **PROF-04**: User can clone an existing profile as a starting point for a new one
- [ ] **PROF-05**: User can mark one profile as active (exclusive — only one active at a time)
- [ ] **PROF-06**: Active profile is visually indicated in the sidebar

### Model Configuration (LLM Tab)

- [ ] **MODEL-01**: User can set the base connection using OpenAI-compatible schema (base URL, API key, model name)
- [ ] **MODEL-02**: User can add custom request headers to override the OpenAI base for the LLM provider
- [ ] **MODEL-03**: User can add custom body params to override the OpenAI base for the LLM provider
- [ ] **MODEL-04**: User can configure a custom endpoint path (override default /v1/chat/completions)
- [ ] **MODEL-05**: User can write and save the system prompt for the assistant
- [ ] **MODEL-06**: User can configure the first message (assistant speaks first or waits)
- [ ] **MODEL-07**: User can enable/disable greeting and set the greeting instruction

### Voice Configuration (TTS Tab)

- [ ] **VOICE-01**: User can set the TTS base connection using OpenAI-compatible schema (base URL, API key)
- [ ] **VOICE-02**: User can configure a custom endpoint path (override default /v1/audio/speech)
- [ ] **VOICE-03**: User can set the voice ID used in TTS requests
- [ ] **VOICE-04**: User can add custom body params (e.g. speed, format, model) to override OpenAI base
- [ ] **VOICE-05**: User can add custom request headers for the TTS provider
- [ ] **VOICE-06**: User can test TTS by sending a test phrase and hearing audio playback in browser

### Transcriber Configuration (STT Tab)

- [ ] **STT-01**: User can set the STT base connection using OpenAI-compatible schema (base URL, API key)
- [ ] **STT-02**: User can configure a custom endpoint path (override default /v1/audio/transcriptions)
- [ ] **STT-03**: User can set the STT model and language
- [ ] **STT-04**: User can add custom request headers for the STT provider
- [ ] **STT-05**: User can add custom body/query params to override OpenAI base for the STT provider
- [ ] **STT-06**: User can test STT by recording from mic and seeing the transcription result

### Tools Configuration (Tools Tab)

- [ ] **TOOLS-01**: User can configure the N8N webhook base URL
- [ ] **TOOLS-02**: User can configure the N8N webhook path for order processing
- [ ] **TOOLS-03**: User can configure the N8N MCP webhook path
- [ ] **TOOLS-04**: User can test N8N connectivity (ping webhook URL, show success/fail)
- [ ] **TOOLS-05**: User can import server config by pasting a cURL command (auto-fills fields)

### Provider Adapter System (Voice Agent)

- [ ] **ADAPT-01**: Voice agent uses OpenAI-compatible client as the base for all LLM, TTS, and STT requests
- [ ] **ADAPT-02**: Service-specific adapters can override request headers on top of the OpenAI base
- [ ] **ADAPT-03**: Service-specific adapters can override body params on top of the OpenAI base
- [ ] **ADAPT-04**: Service-specific adapters can override endpoint paths on top of the OpenAI base
- [ ] **ADAPT-05**: Service-specific adapters can remap request/response fields for non-OpenAI response shapes

### Call Logs

- [ ] **LOGS-01**: Call sessions are persisted to the database when a session ends (profile ID, start time, duration, outcome)
- [ ] **LOGS-02**: User can view a table of past call sessions with date, duration, profile used, and outcome
- [ ] **LOGS-03**: User can filter call logs by profile
- [ ] **LOGS-04**: User can filter call logs by date range

### App & Deployment

- [x] **APP-01**: Dashboard runs as a standalone Next.js app in the npm monorepo (apps/voice-dashboard)
- [x] **APP-02**: Dashboard is accessible at agent.coziyoo.com via Nginx proxy
- [x] **APP-03**: Dashboard integrates with CI/CD pipeline (deploy on push, same as other services)

## v2 Requirements

Deferred to future release.

### Enhanced Testing

- **TEST-01**: Live model auto-discovery (fetch available models from Ollama /api/tags)
- **TEST-02**: Full provider health dashboard showing latency per provider

### Advanced Profile Features

- **ADV-01**: Profile version history (rollback to previous config)
- **ADV-02**: Export/import profiles as JSON
- **ADV-03**: Profile usage stats (how many calls used this profile)

### Monitoring

- **MON-01**: Call log detail view (full session transcript if available)
- **MON-02**: Aggregate stats (calls per day, avg duration, success rate)
- **MON-03**: Real-time active session indicator

## Out of Scope

| Feature | Reason |
|---------|--------|
| Seller self-service | Internal ops tool only — sellers don't access this |
| Per-device profile assignment | One active profile at a time, simpler model |
| Real-time call audio monitoring | Call logs only, no live listen-in |
| Phone number management | Not a telephony platform |
| Multi-tenant team management | Single-team internal tool |
| Billing/usage metering | Internal tool, no cost tracking |
| Flow/conversation designer | Prompt-based only |
| Mobile app | Web only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Complete |
| AUTH-02 | Phase 1 | Complete |
| AUTH-03 | Phase 1 | Complete |
| APP-01 | Phase 1 | Complete |
| APP-02 | Phase 1 | Complete |
| APP-03 | Phase 1 | Complete |
| PROF-01 | Phase 2 | Pending |
| PROF-02 | Phase 2 | Pending |
| PROF-03 | Phase 2 | Pending |
| PROF-04 | Phase 2 | Pending |
| PROF-05 | Phase 2 | Pending |
| PROF-06 | Phase 2 | Pending |
| MODEL-01 | Phase 2 | Pending |
| MODEL-02 | Phase 2 | Pending |
| MODEL-03 | Phase 2 | Pending |
| MODEL-04 | Phase 2 | Pending |
| MODEL-05 | Phase 2 | Pending |
| MODEL-06 | Phase 2 | Pending |
| MODEL-07 | Phase 2 | Pending |
| VOICE-01 | Phase 2 | Pending |
| VOICE-02 | Phase 2 | Pending |
| VOICE-03 | Phase 2 | Pending |
| VOICE-04 | Phase 2 | Pending |
| VOICE-05 | Phase 2 | Pending |
| VOICE-06 | Phase 2 | Pending |
| STT-01 | Phase 2 | Pending |
| STT-02 | Phase 2 | Pending |
| STT-03 | Phase 2 | Pending |
| STT-04 | Phase 2 | Pending |
| STT-05 | Phase 2 | Pending |
| STT-06 | Phase 2 | Pending |
| TOOLS-01 | Phase 2 | Pending |
| TOOLS-02 | Phase 2 | Pending |
| TOOLS-03 | Phase 2 | Pending |
| TOOLS-04 | Phase 2 | Pending |
| TOOLS-05 | Phase 2 | Pending |
| ADAPT-01 | Phase 3 | Pending |
| ADAPT-02 | Phase 3 | Pending |
| ADAPT-03 | Phase 3 | Pending |
| ADAPT-04 | Phase 3 | Pending |
| ADAPT-05 | Phase 3 | Pending |
| LOGS-01 | Phase 4 | Pending |
| LOGS-02 | Phase 4 | Pending |
| LOGS-03 | Phase 4 | Pending |
| LOGS-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 45 total
- Mapped to phases: 45
- Unmapped: 0

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after roadmap creation*
