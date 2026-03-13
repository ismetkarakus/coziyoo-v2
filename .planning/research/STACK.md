# Stack Research

**Domain:** Voice-first food ordering marketplace — brownfield integration
**Researched:** 2026-03-12
**Confidence:** HIGH (LiveKit official docs verified), MEDIUM (n8n patterns from community + official docs)

---

## Context: What This Research Covers

The core tech stack already exists and is locked by constraint. This research focuses on the **integration seams** between the three systems that are broken or unverified:

1. Expo mobile app → LiveKit voice session startup
2. Python voice agent → n8n webhook LLM round-trip
3. End-of-call webhook → API → n8n → order creation

Research answers: are the current versions right, what configuration is critical, and what patterns make these seams reliable?

---

## Recommended Stack

### Core Technologies

| Technology | Current Version (in repo) | Latest Verified | Purpose | Status |
|------------|--------------------------|-----------------|---------|--------|
| `livekit-agents` | `>=1.2.6` | `1.4.5` (2026-03-11) | Python agent framework, VAD, STT/TTS/LLM pipeline | UPGRADE RECOMMENDED |
| `livekit-plugins-silero` | `>=1.2.6` | `1.4.5` | Silero VAD for voice activity detection | UPGRADE RECOMMENDED |
| `livekit-plugins-turn-detector` | `>=1.4.5` | `1.4.5` | Multilingual turn detection model | CURRENT |
| `livekit-server-sdk` (Node.js) | `^2.15.0` | `2.15.0` | Token generation, room management, agent dispatch | CURRENT |
| `@livekit/react-native` | `2.9.6` | `2.x` latest | React Native LiveKit hooks and components | VERIFY (see notes) |
| `@livekit/react-native-webrtc` | `137.0.2` | `137.x` | WebRTC bindings for React Native | CURRENT |
| `livekit-client` (mobile) | `^2.9.4` | `2.17.2` | WebRTC client, room state | UPGRADE RECOMMENDED |
| n8n | self-hosted | self-hosted | LLM orchestration brain, order workflow | KEEP as-is |
| FastAPI | `>=0.115.0` | `0.115.x` | Agent join API + log viewer at :9000 | CURRENT |

**Key finding:** `livekit-agents` 1.4.5 was released 2026-03-11 — one day before this research. The project pins `>=1.2.6`. Upgrading to `>=1.4.5` is recommended because 1.4.2 fixed multiple memory leaks in the process pool.

**Critical finding:** `livekit-client` in mobile is `^2.9.4`, but `2.15.11` had a confirmed bug that caused React Native apps to get stuck in "connecting" state indefinitely (livekit/client-sdk-react-native issue #304). Fixed in `2.15.12`. The current `2.9.4` range predates this bug and should be safe, but upgrading to `2.17.2` (latest) is recommended to pick up other fixes.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `livekit-plugins-openai` | `>=1.0.0` | OpenAI-compatible LLM + STT plugin | Used as fallback when n8n is not configured; also handles Whisper-compatible STT |
| `livekit-plugins-noise-cancellation` | `>=0.2.5` | BVC/BVCTelephony audio filtering | Only enable via `LIVEKIT_ENABLE_NOISE_CANCELLATION=true` AND only for LiveKit Cloud — code already guards this correctly |
| `aiohttp` | `>=3.10.0` | Async HTTP for n8n webhook calls and session-end reporting | Already used in voice agent; keep for all outgoing HTTP in agent |
| `pydantic` | `>=2.10.6` | Request validation in FastAPI join API | Current, keep |
| `fast-text-encoding` | `^1.0.6` | TextDecoder polyfill for React Native | Required for data channel message decoding (agent-action topic) |
| `@config-plugins/react-native-webrtc` | peer dep | Expo config plugin for WebRTC | Required in app.json plugins array |
| `@livekit/react-native-expo-plugin` | peer dep | Expo config plugin for LiveKit | Required in app.json plugins array |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| LiveKit log viewer (`/logs/viewer` on :9000) | Voice agent request log UI | Already implemented in `join_api.py`; broken in current deploy — likely a port or startup issue, not a code issue |
| n8n UI (default `:5678`) | Workflow editing and testing | Use "Test Webhook" mode during development; switch to "Production Webhook" for deployed agent |
| LiveKit Playground / CLI | Verify room creation and token validity independently of mobile | `npx livekit-cli ...` can join rooms to confirm agent dispatch works before debugging mobile |

---

## Integration Patterns: What Makes Each Seam Reliable

### Seam 1: Mobile → LiveKit Session Startup

**The pattern that works:**

```
Mobile calls POST /v1/livekit/voice/start (API)
  → API creates room (ensureLiveKitRoom)
  → API mints token (mintLiveKitToken)
  → API calls voice agent join endpoint (dispatchAgentJoin)
  → API returns {token, wsUrl, roomName, agentIdentity}
  → Mobile configures AudioSession BEFORE connecting
  → Mobile sets connect={audioReady} on <LiveKitRoom> (gates connection on audio config)
  → Agent joins room (dispatched explicitly)
  → Mobile detects agent via useParticipants() with fallback logic
```

**Critical configuration for iOS audio:**

The `VoiceSessionScreen.tsx` already implements the correct pattern:
1. `AudioSession.configureAudio()` with `communication` preset on Android
2. `AudioSession.setAppleAudioConfiguration()` with `playAndRecord` + `voiceChat` mode on iOS
3. `AudioSession.startAudioSession()` before setting `audioReady = true`
4. `<LiveKitRoom connect={audioReady}>` gates connection until audio is ready

This sequence is correct and must not be reordered. If audio setup fails, the code intentionally still sets `audioReady = true` to allow connection — this fallback is correct.

**Known issue to watch:** `livekit-client` 2.15.11 caused stuck-connecting on React Native (fixed in 2.15.12). If upgrading the mobile `livekit-client` dependency, avoid the 2.15.9–2.15.11 range.

**Known issue to watch:** React Native New Architecture (bridgeless mode, enabled by default in React Native 0.76+) has reported incompatibilities with LiveKit (livekit/client-sdk-react-native issue #305). Expo 52 uses React Native 0.76. If connection issues persist on device, verify New Architecture is not the cause by temporarily disabling it in `app.json` (`"newArchEnabled": false`).

**Agent identity fallback (already implemented correctly):**

```typescript
// In VoiceSessionScreen.tsx — correct pattern
const agentParticipant =
  participants.find((p) => p.identity === agentIdentity) ??
  participants.find((p) => p.identity !== room.localParticipant?.identity);
```

This fallback is necessary because the LiveKit Agents framework assigns its own participant identity to the agent process, which may not match the `agentIdentity` string built by the API.

### Seam 2: Voice Agent → n8n LLM Round-Trip

**The pattern that works:**

The agent calls n8n synchronously as its LLM. The `N8nLLM` class already implements a primary + fallback strategy:
1. **Primary:** POST to n8n webhook URL → expect JSON response with `replyText|answer|text|output|message`
2. **Fallback:** POST to n8n REST API `/api/v1/workflows/{id}/run` → poll `/api/v1/executions/{id}` after 600ms

**Critical n8n configuration for synchronous LLM responses:**

n8n webhooks have a **60-second synchronous response timeout** (cloud imposes ~100 seconds via gateway). For voice agent use, the n8n webhook workflow MUST:
- Use **"Respond Using 'Respond to Webhook' Node"** response mode (not "Respond at End of Workflow")
- Place the `Respond to Webhook` node immediately after the AI Agent node
- Keep the LLM call under 30 seconds to stay within the agent's timeout (`conn_options.timeout`)
- Return JSON with a `replyText` (or `answer` or `text`) key at the top level

**What the voice agent sends to n8n:**

```json
{
  "workflowId": "...",
  "source": "voice-agent",
  "roomId": "...",
  "jobId": "...",
  "userText": "...",
  "messages": [{"role": "user", "content": "..."}],
  "locale": "en",
  "userMemory": {...}
}
```

**What n8n must return:**

```json
{ "replyText": "Here are today's available meals..." }
```

Any of these keys work: `replyText`, `answer`, `text`, `output`, `message`. The agent also does deep traversal via `_deep_find_answer()` if top-level keys are missing, but top-level is most reliable.

### Seam 3: End-of-Call → API → n8n → Order Creation

**The pattern that works:**

```
Room disconnects (room.on("disconnected") event fires)
  → agent calls POST /v1/livekit/session/end on the API
    with header: x-ai-server-secret: {AI_SERVER_SHARED_SECRET}
    with body: {roomName, summary, startedAt, endedAt, outcome, deviceId}
  → API validates shared secret (separate from JWT auth)
  → API calls n8n session-end webhook (sendSessionEndEvent in n8n.ts)
  → n8n workflow processes order from conversation summary
  → n8n calls back to API POST /v1/orders (or creates order directly in DB)
```

**Critical: the disconnect event reliability problem**

`session.start()` in livekit-agents 1.x is non-blocking — it returns after initializing. The entrypoint then waits on `disconnect_fut` (already implemented correctly in `entrypoint.py`):

```python
# Already in entrypoint.py — correct pattern
disconnect_fut: asyncio.Future[None] = asyncio.get_event_loop().create_future()

def _on_disconnected(*_args):
    if not disconnect_fut.done():
        disconnect_fut.set_result(None)

ctx.room.on("disconnected", _on_disconnected)
await session.start(...)
await disconnect_fut  # wait here until room disconnects
await _notify_session_end(...)
```

**Known issue:** `on("disconnected")` does not fire reliably when the process exits unexpectedly (livekit/agents issue #1581). The current implementation handles the normal case; abnormal exits (crash, SIGKILL) will miss the session-end call. Mitigation: use a session heartbeat or timeout in n8n to detect abandoned sessions.

**Required environment variables for this seam:**

```
API_BASE_URL=http://127.0.0.1:3000      # voice agent → API
AI_SERVER_SHARED_SECRET=...             # must be set on both API and voice agent
N8N_HOST=http://...                     # API → n8n
N8N_LLM_WORKFLOW_ID=...
```

---

## Installation

```bash
# Python voice agent — upgrade to latest stable
pip install "livekit-agents>=1.4.5" "livekit-plugins-silero>=1.4.5" "livekit-plugins-turn-detector>=1.4.5"

# Mobile — upgrade livekit-client (in apps/mobile)
npm install livekit-client@^2.17.2 --workspace=apps/mobile

# Node.js API — already at latest
npm install livekit-server-sdk@^2.15.0 --workspace=apps/api
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| n8n as LLM brain (existing) | Direct Ollama from voice agent | Only if n8n adds too much latency (>2s added). Direct Ollama is faster but loses workflow flexibility |
| Explicit agent dispatch via join API | Auto-dispatch (auto-join all rooms) | Auto-dispatch works but assigns agent to every room including admin monitoring rooms — explicit dispatch is correct for production |
| Synchronous n8n webhook for LLM response | n8n execution API polling (fallback) | Polling fallback already implemented for reliability; primary webhook is faster |
| aiohttp for all agent HTTP calls | httpx | Both work; aiohttp is already used throughout and avoids adding a dependency |
| Session-end via API → n8n | Direct n8n call from voice agent | Going through the API preserves audit trail and allows API-side auth logic |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `livekit-client` 2.15.9–2.15.11 (mobile) | Confirmed bug causing stuck-connecting on React Native (issue #304) | `2.15.12+` or stay on `2.9.x` branch currently in use |
| n8n "Respond at End of Workflow" mode for LLM responses | Workflow can easily exceed 60s timeout causing silent failures | "Respond Using 'Respond to Webhook' Node" with explicit placement |
| `LIVEKIT_ENABLE_NOISE_CANCELLATION=true` on self-hosted LiveKit | BVC/BVCTelephony filters are LiveKit Cloud-only; causes noisy errors on self-hosted | Keep `LIVEKIT_ENABLE_NOISE_CANCELLATION=false` (default) until on LiveKit Cloud |
| Auto-dispatch (no `agent_name`) for production | Agent joins every new room including test/admin rooms | Explicit dispatch with `agent_name="coziyoo-voice-agent"` (already set) |
| React Native New Architecture (bridgeless) with LiveKit | Active compatibility issues reported in issue #305 with RN 0.76 + LiveKit | Disable with `"newArchEnabled": false` in app.json if connection failures occur on device |
| Polling n8n execution API as primary path (not fallback) | ~600ms added latency minimum + polling is brittle | Use webhook as primary, execution API only as fallback |

---

## Stack Patterns by Variant

**If n8n webhook returns empty body or unexpected format:**
- The agent's `_deep_find_answer()` performs recursive traversal on any nested JSON structure
- Still fails if n8n returns a 2xx with no body or body is an array with no string fields
- Fix: ensure n8n `Respond to Webhook` node returns `{ "replyText": "..." }` explicitly

**If the agent join endpoint (port 9000) is not reachable from the API:**
- The session flow silently fails: room and token are created, but no agent ever joins
- Mobile shows "Waiting for agent..." and hits the 30-second timeout
- Fix: verify `VOICE_AGENT_JOIN_URL` env var on API points to the correct internal address

**If voice agent log viewer at :9000/logs/viewer shows no data:**
- `VOICE_AGENT_REQUEST_LOG_FILE` must point to a writable path that both the agent worker and the join API process can access
- Default is `/workspace/.runtime/voice-agent-requests.log`
- Fix: verify the path exists, is writable, and that `run_in_background` / systemd service has the correct working directory

**If AudioSession setup on iOS causes microphone not to capture:**
- Must not mix `expo-audio` (useAudioPlayer) with LiveKit audio session (known conflict, issue #286)
- The LiveKit audio session and any other audio player fight over iOS audio session category
- Fix: avoid using expo-audio for any sound playback while a LiveKit session is active

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `livekit-agents>=1.4.5` | Python 3.10–3.14 | Dropped Python 3.9 support; project uses Python 3.11+ so this is fine |
| `livekit-agents>=1.4.5` | `livekit-plugins-silero>=1.4.5` | Plugin versions should match agents version for API stability |
| `livekit-agents>=1.4.5` | `livekit-plugins-turn-detector>=1.4.5` | Same — keep plugin versions in sync with agents |
| `@livekit/react-native@2.9.6` | Expo ~52.0.46 (React Native 0.76.9) | Current version confirmed working; avoid 2.15.9–2.15.11 `livekit-client` |
| `@livekit/react-native-webrtc@137.0.2` | React Native 0.76.x | Unified Plan only (since 106.0.0); confirmed compatible |
| `livekit-server-sdk@2.15.0` | Node.js 20+ | toJwt() is async in v2 (was sync in v1) |
| `Expo ~52.0.46` | React Native 0.76.9 | New Architecture enabled by default in this combo — verify LiveKit works |

---

## Sources

- [livekit-agents PyPI](https://pypi.org/project/livekit-agents/) — confirmed 1.4.5 latest, Python 3.10+ requirement (HIGH confidence)
- [livekit/agents GitHub releases](https://github.com/livekit/agents/releases) — 1.4.2 memory leak fix, 1.4.x changelog (HIGH confidence)
- [LiveKit Agents dispatch docs](https://docs.livekit.io/agents/server/agent-dispatch/) — explicit vs auto dispatch, agent_name behavior (HIGH confidence)
- [LiveKit Agent session docs](https://docs.livekit.io/agents/logic/sessions/) — session.start() non-blocking behavior, auto-close on disconnect (HIGH confidence)
- [livekit-plugins-turn-detector PyPI](https://pypi.org/project/livekit-plugins-turn-detector/) — 1.4.5 latest, ~400MB RAM, 14 languages including Turkish (HIGH confidence)
- [livekit/client-sdk-react-native issue #304](https://github.com/livekit/client-sdk-react-native/issues/304) — stuck-connecting bug in 2.15.9–2.15.11 (MEDIUM confidence, from issue report)
- [livekit/client-sdk-react-native issue #305](https://github.com/livekit/client-sdk-react-native/issues/305) — New Architecture / bridgeless mode incompatibility (MEDIUM confidence, active issue)
- [livekit/client-sdk-react-native issue #286](https://github.com/livekit/client-sdk-react-native/issues/286) — expo-audio + LiveKit audio session conflict on iOS (MEDIUM confidence, from issue report)
- [LiveKit Expo quickstart](https://docs.livekit.io/transport/sdk-platforms/expo/) — installation command, app.json plugin config, registerGlobals() requirement (HIGH confidence)
- [livekit/agents issue #1581](https://github.com/livekit/agents/issues/1581) — on("disconnected") unreliable on unexpected exit (MEDIUM confidence, from issue report)
- n8n community + docs — 60s/100s webhook timeout, "Respond to Webhook" node pattern (MEDIUM confidence, community-sourced)
- Codebase analysis — entrypoint.py, join_api.py, VoiceSessionScreen.tsx, livekit.ts confirmed reading current implementation (HIGH confidence)

---
*Stack research for: voice-first food ordering marketplace (Expo + LiveKit Python Agents + n8n)*
*Researched: 2026-03-12*
