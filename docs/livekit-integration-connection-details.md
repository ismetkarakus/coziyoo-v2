# LiveKit Integration Connection Details

Last updated: 2026-02-24

## 1) LiveKit

- `LIVEKIT_URL`: `https://livekit.coziyoo.com/` (client should use `wss://livekit.coziyoo.com/`)
- `LIVEKIT_API_KEY`: set in API/Coolify env (not stored in repo)
- `LIVEKIT_API_SECRET`: set in API/Coolify env (not stored in repo)
- `LIVEKIT_AGENT_IDENTITY`: default `coziyoo-ai-agent`

## 2) API Server

- Public API base: `https://api.coziyoo.com`
- Starter endpoints (already in backend):
  - `POST /v1/livekit/starter/session/start`
  - `POST /v1/livekit/starter/agent/chat`
  - `POST /v1/livekit/starter/stt/transcribe`

## 3) AI Server

- `AI_SERVER_URL`: must be set in API env (not present in repo-local env file)
- `AI_SERVER_LIVEKIT_JOIN_PATH`: `/livekit/agent-session`
- `AI_SERVER_TIMEOUT_MS`: `10000`
- `AI_SERVER_SHARED_SECRET`: must be set in API env

Notes:
- API dispatches room-scoped agent join to AI server from `POST /v1/livekit/starter/session/start`.
- AI server must accept join payload with LiveKit token and connect to the room.

## 4) Ollama (LLM behind API)

- `OLLAMA_BASE_URL`: `https://ollama.drascom.uk`
- Model in local env: `ministral-3:8b`
- Timeout in local env: `20000`

## 5) STT Server (Speaches/Faster-Whisper)

- `SPEECH_TO_TEXT_BASE_URL`: `https://speech.drascom.uk/`
- `SPEECH_TO_TEXT_TRANSCRIBE_PATH`: `/v1/audio/transcriptions`
- Working model used in test: `Systran/faster-whisper-medium`
- `SPEECH_TO_TEXT_API_KEY`: required (`Authorization: Bearer ...`)
- `SPEECH_TO_TEXT_TIMEOUT_MS`: `60000`

## 6) TTS

- No dedicated external TTS URL is currently configured in backend env schema.
- If using Speaches for TTS, endpoint would typically be `/v1/audio/speech` on the same host.
- Decision required before implementation:
  - keep browser `speechSynthesis` fallback, or
  - add backend-managed TTS provider/envs and proxy route.
