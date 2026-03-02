# TASKLIST

## Phase 0
1. Create `apps/mobile` scaffold.
2. Save `PLAN.md` and `TASKLIST.md` in `apps/mobile`.
3. Commit and push.

## Phase 1 - Mobile Foundation
1. Add React Native app shell and navigation.
2. Add API client + auth flow.
3. Add settings screen for STT/TTS/LLM/n8n profile binding.
4. Add voice session manager for LiveKit.
5. Add DataChannel action parser + deterministic dispatcher.

## Phase 2 - API Alignment
1. Extend `/v1/livekit/session/start` metadata fields:
- `locale`
- `campaignId`
- `leadId`
- `channel`
- `deviceId`
- `settingsProfileId`
2. Keep `/v1/livekit/session/end` idempotent and secret-authenticated.

## Phase 3 - Agent Runtime
1. Create modular agent service in `apps/voice-agent`.
2. Add provider interfaces for STT/LLM/TTS.
3. Implement remote speech STT adapter.
4. Implement Ollama-compatible LLM adapter.
5. Implement streaming TTS adapter.
6. Emit strict action JSON over DataChannel.
7. Post session summary to API end endpoint.

## Phase 4 - Hardening
1. Unit tests for action schema/dispatcher.
2. Integration tests for session bootstrap + auth + session end.
3. E2E validation: voice interaction and UI actions.
4. Retry/backoff and dead-letter path for n8n delivery.
5. Observability and rollout checklist.
