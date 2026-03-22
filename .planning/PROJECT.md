# Voice Agent Dashboard

## What This Is

A standalone Next.js dashboard at `agent.coziyoo.com` for internal operations — creating and managing voice agent profiles, configuring LLM/STT/TTS/tools per profile, marking one profile as active (all LiveKit calls use it), and monitoring call logs. Inspired by the vapi.ai dashboard UX. This replaces the VoiceAgentSettingsPage currently embedded in the admin panel.

## Core Value

The team can switch between fully-configured voice agent profiles instantly — tuning model, voice, transcriber, and tools — without touching code or redeploying the agent.

## Requirements

### Validated

- ✓ Voice agent runs as LiveKit Agents worker — existing
- ✓ Join API dispatches agent to LiveKit room — existing
- ✓ Admin JWT authentication (ADMIN_JWT_SECRET) — existing
- ✓ VoiceAgentSettingsPage in admin panel (STT, TTS, N8N, general settings) — existing, to be superseded
- ✓ API routes for agent settings under `/api` Express app — existing

### Active

- [ ] User can log in to dashboard at agent.coziyoo.com using admin credentials
- [ ] User can create a named agent profile
- [ ] User can configure LLM settings per profile (Ollama model, system prompt, first message, greeting)
- [ ] User can configure STT settings per profile (provider, server, model, language)
- [ ] User can configure TTS settings per profile (provider, server URL, voice ID, engine params)
- [ ] User can configure N8N/tools settings per profile (webhook URLs)
- [ ] User can mark one profile as active (all voice sessions use it)
- [ ] User can view call logs (session history, duration, linked profile, success/failure)
- [ ] Dashboard is deployed as a standalone Next.js app (apps/voice-dashboard workspace)
- [ ] Dashboard authenticates via existing admin JWT (shared ADMIN_JWT_SECRET)

### Out of Scope

- Seller self-service — internal ops tool only, sellers do not access this dashboard
- Per-device profile assignment — one active profile at a time for all calls
- Real-time call monitoring / live audio — call logs only, no live listen-in
- Mobile app for dashboard — web only

## Context

- Existing voice agent stack: Python/FastAPI/LiveKit Agents at port 9000 (`apps/voice-agent`)
- Existing admin panel: React/Vite at port 5174/8000 (`apps/admin`) — shares JWT realm we'll reuse
- VoiceAgentSettingsPage in admin panel currently manages STT servers, TTS servers, N8N servers, and general agent settings — this data model informs the profile schema
- Voice agent reads its runtime config from the API (not env directly for per-call settings)
- Profile "active" switch must propagate to the voice agent at session start — the agent fetches config from the API at join time
- vapi.ai dashboard snapshots define the target UX pattern (left sidebar assistant list, tabbed config: Model | Voice | Transcriber | Tools | Analysis)
- Database migrations: apply directly to Supabase via API — do NOT create migration files

## Constraints

- **Auth**: Must reuse admin JWT realm — no new auth system
- **Deployment**: New `apps/voice-dashboard` npm workspace, served at agent.coziyoo.com via Nginx
- **Stack**: Next.js (agreed) — app router or pages router TBD at planning phase
- **API**: New API routes in `apps/api` for profile CRUD — follows existing route/service patterns
- **DB**: Profiles stored in PostgreSQL — apply schema changes directly to Supabase

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Standalone app vs admin extension | User wants separate URL (agent.coziyoo.com), cleaner separation | — Pending |
| Next.js over React/Vite | User preference | — Pending |
| Reuse admin JWT | No new auth overhead, same team uses both dashboards | — Pending |
| One active profile at a time | Simplest activation model, switch when testing different configs | — Pending |

---
*Last updated: 2026-03-22 after initialization*
