# Mobile Voice Assistant Replatform Plan

## Summary
Replatform to a mobile-first stack with `apps/mobile` (React Native), keep `apps/api` as the main backend, and run realtime voice with LiveKit + LiveKit Agents.

## Locked Decisions
1. `apps/api` remains the single business backend.
2. Legacy `apps/web` and `apps/agent` will be removed.
3. New client lives in `apps/mobile`.
4. Voice uses LiveKit duplex audio + DataChannel actions.
5. UI actions are strict allowlisted JSON commands.
6. Session bootstrap and auth use existing `apps/api` contracts.

## Core Architecture
1. Mobile app authenticates against API.
2. Mobile starts LiveKit session via `/v1/livekit/session/start`.
3. API mints tokens and dispatches voice agent.
4. Agent handles STT -> LLM -> TTS and emits DataChannel actions.
5. Mobile validates actions and updates local UI state.
6. Agent posts session end summary to `/v1/livekit/session/end`.
7. API emits normalized events to n8n with idempotency.

## DataChannel Contract
- Envelope: `type`, `version`, `requestId`, `timestamp`, `action`.
- Action fields: `name`, `params`, `policy`.
- Unknown version/action or schema mismatch is rejected.

## Provider Direction
- STT: remote speech server.
- LLM: remote Ollama by default, override by settings profile.
- TTS: pluggable provider interface.
- n8n: invoked by API, not directly by mobile.
