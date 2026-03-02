# Mobile Voice Assistant Replatform Plan

## Goal
Deliver a production-oriented voice-first mobile foundation where realtime voice, deterministic action control, and backend orchestration are cleanly separated.

## Scope
1. Mobile client is `apps/mobile` (React Native single codebase).
2. Main backend remains `apps/api`.
3. Legacy `apps/web` and `apps/agent` are removed.
4. Agent runtime is split into `apps/voice-agent`.

## Architecture
1. Mobile authenticates using `apps/api`.
2. Mobile starts session via `POST /v1/livekit/session/start`.
3. API mints user token and dispatches agent join.
4. Agent streams voice and emits strict action messages over DataChannel.
5. Mobile validates action schema and executes allowlisted actions only.
6. Agent sends end-of-session summary to API.
7. API delivers normalized event to n8n with idempotency.

## Session Metadata Extension
`/v1/livekit/session/start` accepts optional:
- `locale`
- `campaignId`
- `leadId`
- `channel`
- `deviceId`
- `settingsProfileId`

## Deterministic Action Rules
1. Messages must match versioned envelope: `type=action`, `version=1.0`.
2. Unknown version/action is rejected.
3. Invalid schema is rejected.
4. App executes only allowlisted action names.
5. High-risk actions require confirmation policy.

## Provider Direction
1. STT default: remote speech server.
2. LLM default: remote Ollama.
3. TTS: modular provider adapter.
4. n8n invoked by API only.
