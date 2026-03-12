# Architecture Research

**Domain:** Voice-first food ordering marketplace — LiveKit voice agent integration with n8n workflow orchestration
**Researched:** 2026-03-12
**Confidence:** HIGH (source-code verified, no speculation)

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        MOBILE CLIENT (Expo)                          │
│  HomeScreen: POST /v1/livekit/starter/session/start                  │
│  VoiceSessionScreen: LiveKitRoom → AudioSession → data channel       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  HTTP (REST)
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      NODE.JS API  (port 3000)                        │
│  routes/livekit.ts                                                   │
│  ┌─────────────────────┐  ┌────────────────────────────────────┐     │
│  │  /starter/session/  │  │  /livekit/session/end              │     │
│  │  start (public)     │  │  (shared-secret auth only)         │     │
│  │                     │  │  → services/n8n.ts                 │     │
│  │  1. ensureRoom      │  │    sendSessionEndEvent()           │     │
│  │  2. mintToken(user) │  │    → POST n8n /webhook/            │     │
│  │  3. mintToken(agent)│  │      coziyoo/session-end           │     │
│  │  4. dispatchAgent   │  │    retry 3x (exp backoff)          │     │
│  │  5. n8nPreflight    │  └────────────────────────────────────┘     │
│  └──────────┬──────────┘                                             │
│             │ POST /livekit/agent-session                            │
└─────────────┼────────────────────────────────────────────────────────┘
              │  HTTP + x-ai-server-secret header
              ▼
┌──────────────────────────────────────────────────────────────────────┐
│               PYTHON VOICE AGENT  (FastAPI port 9000)                │
│  join_api.py: /livekit/agent-session                                 │
│  → LiveKit API: create_dispatch(agent_name, room, metadata)          │
│                                                                      │
│  entrypoint.py: @server.rtc_session("coziyoo-voice-agent")           │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │  JobContext arrives with metadata JSON                       │     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐   │     │
│  │  │ Silero   │  │   STT    │  │  N8nLLM  │  │   HTTP    │   │     │
│  │  │  VAD     │→ │ (HTTP/   │→ │(webhook  │→ │   TTS     │   │     │
│  │  │          │  │ Whisper) │  │ primary, │  │(F5/XTTS/  │   │     │
│  │  │          │  │          │  │ exec API │  │Chatterbox)│   │     │
│  │  │          │  │          │  │ fallback)│  │           │   │     │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────┘   │     │
│  │                              Each turn: n8n webhook call     │     │
│  │  On session end (room disconnect):                           │     │
│  │  → POST /v1/livekit/session/end (API, shared secret)         │     │
│  └─────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  join_api.py also serves:                                            │
│  /logs/viewer  (HTML log viewer, auto-refreshes every 3s)            │
│  /logs/requests  (JSON log API, filterable by kind/query)            │
└─────────────────────────────────────────────────────────────────────-┘
              │                            │
              │ WebRTC (LiveKit room)       │ HTTP webhook
              ▼                            ▼
┌─────────────────────────┐  ┌────────────────────────────────────────┐
│   LIVEKIT SERVER        │  │              N8N                       │
│   (self-hosted or       │  │  Workflow: N8N_LLM_WORKFLOW_ID         │
│    LiveKit Cloud)       │  │  Called per conversation turn:         │
│                         │  │  input: {workflowId, userText,         │
│  Room lifecycle         │  │   messages, roomId, jobId,             │
│  Participant mgmt       │  │   deviceId, userMemory, locale}        │
│  Data channels          │  │  output: {replyText|answer|text}       │
│  Agent dispatch         │  │                                        │
│                         │  │  Webhook: session-end                  │
└─────────────────────────┘  │  /webhook/coziyoo/session-end          │
                             │  input: {roomName, jobId, summary,     │
                             │   startedAt, endedAt, outcome,         │
                             │   userIdentity, agentIdentity}         │
                             │  → triggers order creation workflow     │
                             └────────────────────────────────────────┘
                                            │
                                            │ n8n writes via HTTP to
                                            ▼
                             ┌────────────────────────────────────────┐
                             │          POSTGRESQL                    │
                             │  orders table, voice_sessions table    │
                             │  (n8n POSTs to API to create orders)   │
                             └────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With | Auth Mechanism |
|-----------|---------------|-------------------|----------------|
| Mobile (Expo) | Session initiation, WebRTC audio, UI action rendering | API (REST), LiveKit (WebRTC), data channel | None for starter session; JWT for authenticated session |
| API `livekit.ts` | Orchestrate session startup, forward session-end to n8n | Voice agent (HTTP), n8n (HTTP), LiveKit (SDK), PostgreSQL | App JWT (session/start), shared secret (session/end) |
| Voice Agent `join_api.py` | Validate and dispatch agent to LiveKit room | LiveKit API, Agent worker process | Shared secret (x-ai-server-secret) |
| Voice Agent `entrypoint.py` | Run the live conversation pipeline per job | STT provider, N8N (per turn), TTS provider, LiveKit room | LiveKit agent credentials from dispatch |
| N8N | LLM orchestration per turn, order creation on session end | Ollama or external LLM, API (to create orders), notification services | Webhook URL + optional API key header |
| LiveKit Server | WebRTC room management, agent dispatch queue | All services that connect to it | API key + secret |
| PostgreSQL | Persistent state: orders, users, sessions, outbox | API only (direct pg pool) | Password |

## Recommended Project Structure

The existing structure is sound. The integration problems are in the seams, not the layout.

```
apps/
├── api/src/
│   ├── routes/
│   │   ├── livekit.ts        # Session start, session end, agent dispatch relay
│   │   └── voice.ts          # Additional voice endpoints (if any)
│   ├── services/
│   │   ├── livekit.ts        # LiveKit SDK wrapper (room, tokens, dispatch)
│   │   ├── n8n.ts            # N8N webhook calls (sendSessionEndEvent, runToolWebhook)
│   │   ├── outbox.ts         # Outbox pattern for reliable event delivery
│   │   └── starter-agent-settings.ts  # Per-device agent config
│   └── db/migrations/        # SQL migrations 0001–0013
├── voice-agent/src/voice_agent/
│   ├── entrypoint.py         # Agent job handler + N8nLLM + session-end notify
│   ├── join_api.py           # FastAPI: agent dispatch + log viewer
│   ├── providers/
│   │   ├── http_stt.py       # Whisper-compatible STT
│   │   └── http_tts.py       # F5/XTTS/Chatterbox TTS
│   └── config/settings.py    # Pydantic settings from env
└── mobile/src/
    ├── screens/HomeScreen.tsx        # Session start UI + preflight checks
    └── screens/VoiceSessionScreen.tsx # LiveKitRoom + data channel actions
```

### Structure Rationale

- **n8n.ts service:** All n8n HTTP calls in one file. `sendSessionEndEvent` has 3-retry exponential backoff. `runN8nToolWebhook` is fire-and-forget for tool calls.
- **entrypoint.py N8nLLM:** N8N is the LLM brain. Primary path = webhook. Fallback = execution API polling (600ms wait hardcoded). Both paths extract answer text from flexible response shapes.
- **join_api.py log viewer:** The log viewer is a self-contained HTML page served at `/logs/viewer`. Reads `voice-agent-requests.log` (rotating file). The viewer groups entries by room_id/job_id into sessions, then into turns (STT req → N8N req/resp → TTS req). Auto-refreshes every 3 seconds.

## Architectural Patterns

### Pattern 1: Two-Hop Session End (Voice Agent → API → N8N)

**What:** When a session ends, the voice agent does NOT call n8n directly. It POSTs to the API (`/v1/livekit/session/end`), which then calls n8n. The API mediates to allow per-device n8n URL overrides from admin settings.

**When to use:** Always for session end — keeps the voice agent decoupled from business logic config.

**Current implementation:**
```
entrypoint.py: _notify_session_end()
  → POST /v1/livekit/session/end
    headers: { x-ai-server-secret: AI_SERVER_SHARED_SECRET }
    body: { roomName, summary, startedAt, endedAt, outcome, deviceId }

API livekit.ts: POST /session/end handler
  → getStarterAgentSettingsWithDefault(deviceId)  // fetch device-specific n8n URL
  → sendSessionEndEvent()  // services/n8n.ts
    → POST {N8N_HOST}/webhook/coziyoo/session-end
       body: { source, roomName, jobId, userIdentity, summary, startedAt,
               endedAt, outcome, metadata }
       retry: 3x with 1s / 2s / 4s exponential backoff
```

**Trade-offs:** Extra HTTP hop adds ~5ms latency but is negligible for end-of-session. Benefit: device-specific n8n configuration stays server-side.

### Pattern 2: N8N as Synchronous LLM (Per-Turn Webhook)

**What:** Every speech turn calls n8n synchronously. The voice agent waits for n8n's HTTP response before synthesizing audio. N8N runs the LLM and returns the reply text.

**When to use:** Required when n8n holds LLM routing, user memory, and tool logic.

**Current implementation:**
```
N8nLLM.chat() → N8nLLMStream._run()
  Payload to n8n: { workflowId, userText, messages (last 24), roomId, jobId,
                    deviceId, userMemory, locale }
  Primary: POST {webhook_url}
    → expects: { replyText|answer|text|output|message } in response body
  Fallback: POST {api_root}/api/v1/workflows/{id}/run
    → wait 600ms
    → GET {api_root}/api/v1/executions/{execution_id}?includeData=true
    → deep-search response for any string value
```

**Trade-offs:** N8N is on the critical path for voice latency. If n8n takes >2s, the conversation feels laggy. The webhook path is fast; the execution API fallback adds 600ms minimum.

### Pattern 3: LiveKit Data Channel for UI Actions

**What:** The voice agent sends structured JSON commands to the mobile client over LiveKit's data channel on topic `agent-action`. Mobile renders banners based on action type.

**Current mobile implementation (VoiceSessionScreen.tsx):**
```typescript
// Agent sends:
{
  type: 'action',
  version: string,
  requestId: string,   // deduplication key (processedIds set)
  timestamp: string,
  action: {
    name: 'navigate' | 'add_to_cart' | 'show_order_summary',
    params: Record<string, unknown>
  }
}

// Mobile renders for 3.5 seconds, then clears banner
// Deduplication: processedIds Set prevents replay
```

**When to use:** Any UI change the agent needs to trigger — add to cart, navigate to screen, show total. Keeps UI state in mobile, not in the voice agent.

**Trade-offs:** Data channel messages are unreliable by default in LiveKit (UDP-based). For order confirmation actions that matter, the agent should use RELIABLE delivery mode.

### Pattern 4: Per-Device Settings for Agent Configuration

**What:** The `starter-agent-settings` table stores per-deviceId overrides: system prompt, TTS config, n8n base URL, LLM provider, greeting. The `/starter/session/start` endpoint reads these and embeds them in the agent metadata JSON passed at dispatch time.

**When to use:** Allows different agent personalities, language models, or n8n endpoints per device without redeployment.

**Current path:**
```
POST /starter/session/start
  → getStarterAgentSettingsWithDefault(deviceId)
  → resolveProviders(settings)
  → embed into agentMetadata JSON string (max 2000 chars)
  → agent receives metadata in JobContext at startup
```

## Data Flow

### Voice Order Pipeline (Happy Path)

```
[User taps "Start Voice Session"]
    ↓
[HomeScreen POST /v1/livekit/starter/session/start]
    ↓
[API: ensureRoom → mintToken(user) → mintToken(agent) → dispatchAgent → n8nPreflight]
    ↓ response: { wsUrl, user.token, roomName, agentIdentity, n8nPreflight }
    ↓ (mobile blocks if agent.dispatched = false)
    ↓
[HomeScreen: check n8nPreflight.reachable → warn if false, allow continue]
    ↓
[VoiceSessionScreen: AudioSession.configure → AudioSession.start → LiveKitRoom.connect]
    ↓
[LiveKit Room: user joined, waiting for agent]
    ↓ (~2-5s, agent dispatch is async)
[Agent joins room, session.start() called]
    ↓
[Agent: on_enter() → generate greeting via N8N call]
    ↓
═══════════════════ PER TURN LOOP ═══════════════════
[User speaks] → [Silero VAD detects speech]
    ↓
[STT provider transcribes audio → text]
    ↓
[N8nLLM.chat() → POST n8n webhook]
    body: userText, messages (chat history), roomId, jobId, userMemory, locale
    ↓
[N8N: run LLM workflow → read/write user memory → return replyText]
    ↓
[N8nLLM: extract answer from response → emit as ChatChunk]
    ↓
[TTS provider synthesizes audio → streams back to room]
    ↓
[Agent optionally: sendRoomData() → data channel topic="agent-action"]
    ↓
[Mobile: RoomEvent.DataReceived → render action banner]
═══════════════════ END LOOP ═══════════════════
    ↓
[User taps "End" or disconnects]
    ↓
[Mobile: room.disconnect() → room "disconnected" event]
    ↓
[entrypoint.py: disconnect_fut resolves → _notify_session_end()]
    POST /v1/livekit/session/end
    { roomName, summary, startedAt, endedAt, outcome, deviceId }
    ↓
[API: validate shared secret → fetch device n8n URL → sendSessionEndEvent()]
    POST {N8N_HOST}/webhook/coziyoo/session-end
    { source, roomName, summary, startedAt, endedAt, outcome, metadata }
    (3 retries with exponential backoff)
    ↓
[N8N: parse session data → run order creation workflow → POST /v1/orders to API]
    ↓
[API: create order record in PostgreSQL]
    ↓
[N8N: send notifications → trigger payment workflow]
```

### Session End Failure Modes

```
Voice Agent → API (session/end):
  - AI_SERVER_SHARED_SECRET mismatch → 401, logged, order NOT created
  - API unreachable (network) → exception caught, logger.warning, silent drop
  - API 503 (secret not set) → silent drop

API → N8N (sendSessionEndEvent):
  - N8N_HOST not configured → 503 returned to agent, order NOT created
  - N8N unreachable → retries 3x (1s, 2s, 4s), then returns ok:false
  - N8N returns 4xx (not 429) → no retry, returns immediately
  - All retries exhausted → API returns 502 to agent

N8N → API (order creation):
  - N8N workflow misconfigured → order silently not created, no feedback loop
  - N8N has no dead-letter mechanism by default
```

### Log Observability Flow

```
entrypoint.py:
  logger "coziyoo-voice-agent" → stdout (level from VOICE_AGENT_LOG_LEVEL)

  request loggers → rotating file {VOICE_AGENT_REQUEST_LOG_FILE}
  (default: /workspace/.runtime/voice-agent-requests.log)
    "coziyoo-voice-agent.requests.stt"  → STT request/response pairs
    "coziyoo-voice-agent.requests.tts"  → TTS request/response pairs
    "coziyoo-voice-agent.requests.llm"  → LLM (Ollama only) request/response
    "coziyoo-voice-agent.requests.n8n"  → N8N request/response/error per turn

  Format: JSON lines, each line:
    { timestamp, level, name, message, job_id?, room_id? }

join_api.py:
  GET /logs/requests?kind=all|stt|tts|llm|n8n&q=search&limit=200
    → reads log file, filters, returns last N entries reversed
  GET /logs/viewer
    → HTML viewer: groups entries by (room_id, job_id) = session
    → each session grouped into turns by STT request boundaries
    → shows: time | USER (STT text) | REPLY (N8N answer or error)
    → auto-refreshes every 3s
  POST /logs/clear
    → truncates log file
```

**Known issue with log viewer:** The viewer groups turns by `room_id` + `job_id` fields, which are only emitted by loggers that explicitly add these fields. The N8N request logger uses `n8n_request_logger.info(...)` without `extra={"room_id": ..., "job_id": ...}`. Turns that lack these extras appear under the "unknown|unknown" session grouping, making the viewer appear empty when there are logs.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-50 concurrent sessions | Current single-process worker handles fine; Silero VAD prewarmed per process |
| 50-200 concurrent sessions | Run multiple voice agent worker processes (`--num-workers N`); they share the same LiveKit dispatch queue |
| 200+ concurrent sessions | LiveKit Cloud or dedicated LiveKit cluster; N8N becomes the bottleneck (webhook latency accumulates); consider moving to streaming n8n or direct LLM |

### Scaling Priorities

1. **First bottleneck: N8N per-turn latency.** Every voice turn blocks on an HTTP roundtrip to N8N. If N8N runs on the same VPS and is under load, turn-around time degrades noticeably. Fix: dedicated N8N host, or bump N8N worker concurrency.
2. **Second bottleneck: STT/TTS provider capacity.** All sessions share one STT endpoint. If STT is slow, the VAD-to-response loop feels broken. Fix: provider autoscaling or fallback pool.

## Anti-Patterns

### Anti-Pattern 1: Calling N8N Session-End Directly from the Voice Agent

**What people do:** Have the voice agent POST directly to N8N `/webhook/coziyoo/session-end` on disconnect.

**Why it's wrong:** The agent can't access per-device n8n URL overrides stored in the API's database. Those overrides are only readable from the Node.js service layer.

**Do this instead:** Voice agent → API `/livekit/session/end` (shared secret) → API reads device settings → API calls n8n. This is the current design and it is correct.

### Anti-Pattern 2: Using n8n Execution API as Primary LLM Path

**What people do:** Configure `N8N_LLM_WEBHOOK_URL` incorrectly, forcing every turn through the execution API (poll with 600ms hardcoded wait).

**Why it's wrong:** Adds 600ms minimum dead time per turn before audio starts. Conversation feels broken.

**Do this instead:** Ensure `N8N_LLM_WEBHOOK_URL` or the webhook trigger is reachable. The webhook path returns synchronously and is 5-10x faster.

### Anti-Pattern 3: Ignoring the n8nPreflight Warning

**What people do:** User taps "Continue" past the "AI Brain Unreachable" alert on the HomeScreen.

**Why it's wrong:** The session connects but the agent either silently errors on every turn (if N8N is misconfigured) or falls back to direct Ollama (if N8N endpoint resolves to empty). Neither gives the user meaningful feedback.

**Do this instead:** Treat n8nPreflight.reachable = false as a hard block in production, not a soft warning. In the admin panel, surface this as an alert.

### Anti-Pattern 4: Missing room_id/job_id in Log Extra Fields

**What people do:** Add new log statements without attaching `extra={"room_id": ..., "job_id": ...}`.

**Why it's wrong:** The log viewer groups entries by (room_id, job_id). Entries without these fields appear under a phantom "unknown" session and are invisible in the turn-by-turn view.

**Do this instead:** Always pass `extra={"room_id": ctx.room.name, "job_id": str(ctx.job.id)}` when logging inside a job context. The `_JsonLineFormatter` serializes these into the JSON output.

## Integration Points

### External Services

| Service | Integration Pattern | Gotchas |
|---------|---------------------|---------|
| LiveKit Server | API key+secret for room management; WebRTC for audio | LIVEKIT_URL must be `wss://` for WebRTC, converted to `https://` internally for REST calls in join_api.py |
| N8N (per-turn LLM) | Synchronous POST webhook, response must include `replyText`/`answer`/`text`/`output`/`message` at any nesting level | Empty response body = conversation hangs; n8n workflow must return one of these keys |
| N8N (session-end) | POST `/webhook/coziyoo/session-end`, 3-retry with backoff | Webhook URL constructed as `{N8N_HOST}/webhook/coziyoo/session-end` — the path segment `coziyoo/session-end` must match the n8n webhook trigger node path exactly |
| STT Provider | Whisper-compatible HTTP API | `SPEECH_TO_TEXT_BASE_URL` + `SPEECH_TO_TEXT_API_KEY` — the API key must be present even for local Whisper, use any non-empty string |
| TTS Provider | HTTP POST, returns audio stream | Three engines (f5-tts, xtts, chatterbox) with different path and body conventions — configured via admin agent settings per device |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Mobile → API | REST HTTP, no auth for starter session | `POST /v1/livekit/starter/session/start` returns wsUrl + token in one call |
| API → Voice Agent | HTTP POST with `x-ai-server-secret` header | `AI_SERVER_URL` env var on API side, `AI_SERVER_SHARED_SECRET` must match on both sides |
| Voice Agent → API | HTTP POST with `x-ai-server-secret` header | `api_base_url` = `API_BASE_URL` env on agent side |
| Voice Agent → N8N | HTTP POST webhook per turn | `N8N_HOST` on agent side (or override from metadata); timeout from `APIConnectOptions` (default LiveKit agents: 10s) |
| API → N8N | HTTP POST via `sendSessionEndEvent()` | Uses `N8N_HOST` + optional per-device override from `starter_agent_settings.tts_config.n8n.baseUrl` |
| LiveKit → Voice Agent | Agent dispatch via LiveKit API | Agent worker registers with `agent_name="coziyoo-voice-agent"`, room dispatch uses same name |

## Suggested Build Order

Based on the integration seams, work from the inside out:

1. **Fix voice session startup (mobile → API → voice agent dispatch)**
   - Verify `AI_SERVER_URL`, `AI_SERVER_SHARED_SECRET`, `AI_SERVER_LIVEKIT_JOIN_PATH` are set
   - Test: `POST /starter/session/start` must return `agent.dispatched = true`
   - Block if not: mobile already checks this

2. **Fix N8N per-turn webhook (voice agent → n8n)**
   - Verify `N8N_HOST` is set and reachable
   - Verify n8n LLM workflow returns `{ replyText: "..." }` or equivalent
   - Test via log viewer at `:9000/logs/viewer` — N8N requests should show `answer=`
   - If answer is empty → check n8n workflow output node

3. **Fix session-end webhook (voice agent → API → n8n)**
   - Verify `API_BASE_URL` is set in voice agent env
   - Verify `AI_SERVER_SHARED_SECRET` matches on both sides
   - Verify n8n `session-end` webhook node path is `/webhook/coziyoo/session-end`
   - Test: end a session, check API logs for `Session end reported to API status=201`
   - Test: check n8n execution history for session-end trigger

4. **Fix order creation (n8n → API)**
   - n8n session-end workflow must POST to `/v1/orders` with valid buyer auth
   - Or n8n uses a service account token stored in its credential store
   - Test: check `orders` table after session end

5. **Fix log viewer observability**
   - Add `extra={"room_id": ..., "job_id": ...}` to all loggers inside job context
   - Without this the viewer shows empty sessions
   - Verify: start a session, check `:9000/logs/viewer` shows session grouped by room

6. **Add admin panel observability**
   - Proxy `:9000/logs/requests` through API or serve admin panel link to voice agent port
   - Surface n8n reachability in admin dashboard (already backed by `getN8nStatus()`)

## Sources

- Source code analysis: `apps/voice-agent/src/voice_agent/entrypoint.py` (direct read)
- Source code analysis: `apps/voice-agent/src/voice_agent/join_api.py` (direct read)
- Source code analysis: `apps/api/src/routes/livekit.ts` (direct read)
- Source code analysis: `apps/api/src/services/n8n.ts` (direct read)
- Source code analysis: `apps/mobile/src/screens/VoiceSessionScreen.tsx` (direct read)
- Source code analysis: `apps/mobile/src/screens/HomeScreen.tsx` (direct read)
- Architecture context: `.planning/codebase/ARCHITECTURE.md` (project analysis)
- Integration context: `.planning/codebase/INTEGRATIONS.md` (project analysis)
- Project context: `.planning/PROJECT.md` (requirements and constraints)

---
*Architecture research for: LiveKit voice agent + n8n integration, Coziyoo v2*
*Researched: 2026-03-12*
