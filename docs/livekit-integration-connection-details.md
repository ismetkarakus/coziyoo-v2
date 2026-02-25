# LiveKit Integration Connection Details

Last updated: 2026-02-25

## 1) LiveKit

- `LIVEKIT_URL`: `https://livekit.example.com/` (client should use `wss://livekit.example.com/`)
- `LIVEKIT_API_KEY`: set in API/Coolify env (not stored in repo)
- `LIVEKIT_API_SECRET`: set in API/Coolify env (not stored in repo)
- `LIVEKIT_AGENT_IDENTITY`: default `assistant-ai-agent`

## 2) API Server

- Public API base: `https://api.example.com`
- Starter endpoints (active):
  - `POST /v1/livekit/starter/session/start`
  - `POST /v1/livekit/starter/agent/chat`
  - `GET /v1/livekit/starter/agent-settings/:deviceId`
  - `PUT /v1/livekit/starter/agent-settings/:deviceId`

`POST /v1/livekit/starter/session/start` now requires:
- `username` (string)
- `deviceId` (8-128 chars, `^[a-zA-Z0-9_-]+$`)

## 3) AI Server

- `AI_SERVER_URL`: must be set in API env (not present in repo-local env file)
- `AI_SERVER_LIVEKIT_JOIN_PATH`: `/livekit/agent-session`
- `AI_SERVER_TIMEOUT_MS`: `10000`
- `AI_SERVER_SHARED_SECRET`: must be set in API env

Notes:
- API dispatches room-scoped agent join to AI server from `POST /v1/livekit/starter/session/start`.
- AI server must accept join payload with LiveKit token and connect to the room.
- Dispatch payload now includes `voiceMode: "assistant_native_audio"` and `payload.deviceId`.

## 4) Ollama (LLM behind API)

- `OLLAMA_BASE_URL`: `https://ollama.example.com`
- Model in local env: `ministral-3:8b`
- Timeout in local env: `20000`

## 5) Assistant-Native Speech Runtime

- Runtime STT/TTS endpoints in API were removed:
  - `/v1/livekit/starter/stt/transcribe`
  - `/v1/livekit/starter/tts/synthesize`
  - `/v1/livekit/stt/transcribe`
  - `/v1/livekit/tts/synthesize`
  - `/v1/admin/livekit/stt/transcribe`
  - `/v1/admin/livekit/tts/synthesize`
- Assistant runtime is the speech execution plane:
  - incoming user audio from LiveKit
  - STT + LLM + TTS in assistant
  - assistant publishes audio track directly to LiveKit room
- API remains control plane: room/session bootstrap, tokening, dispatch, and settings CRUD.

## 6) Assistant Config

- Speech provider settings are expected in assistant runtime `config.json` (global config), not API per-device runtime overrides.
