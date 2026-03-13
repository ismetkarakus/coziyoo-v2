# Pitfalls Research

**Domain:** Voice-first food ordering marketplace — LiveKit + n8n + Expo integration
**Researched:** 2026-03-12
**Confidence:** HIGH (all pitfalls grounded in actual codebase inspection, not speculation)

---

## Critical Pitfalls

### Pitfall 1: AI_SERVER_SHARED_SECRET Misconfiguration Silently Blocks All Session-End Webhooks

**What goes wrong:**
The Python voice agent calls `POST /v1/livekit/session/end` on the Node API after every session. That route checks `env.AI_SERVER_SHARED_SECRET` first — if the secret is not set it returns 503; if the secret is wrong it returns 401. The Python agent's `_notify_session_end()` catches ALL exceptions and only logs a warning — it never retries and never surfaces a user-facing error. The session still ends "successfully" from the user's perspective, but no webhook ever reaches n8n, so no order is created.

**Why it happens:**
`AI_SERVER_SHARED_SECRET` is an optional env var in `apps/api/src/config/env.ts` (line 39: `z.string().min(16).optional()`). It is not in the mandatory section of the root `.env` template. Developers configure `LIVEKIT_URL` and `N8N_HOST` but miss the shared secret that bridges the two services. The Python agent's `_notify_session_end()` swallows the 503/401 with a bare `logger.warning`, making the failure invisible without inspecting logs.

**How to avoid:**
- Add `AI_SERVER_SHARED_SECRET` to startup validation in both services: fail loudly at boot if not set.
- In the Python `_notify_session_end()`, log at ERROR level (not WARNING) when the API returns 4xx/5xx so it surfaces in the log viewer.
- Add a health-check endpoint that validates the shared secret round-trip between the two services.

**Warning signs:**
- Log viewer at `:9000/logs/viewer` shows sessions completing but no n8n entries following them.
- n8n webhook receives no session-end events.
- API logs show no requests to `/v1/livekit/session/end`.

**Phase to address:** Voice session reliability phase (fix session-end webhook chain).

---

### Pitfall 2: N8N Webhook URL Resolution Has Three Competing Paths That Can All Silently Produce the Wrong URL

**What goes wrong:**
The n8n session-end webhook URL is constructed by `sendSessionEndEvent()` in `apps/api/src/services/n8n.ts`, which calls `resolveToolWebhookEndpoint("session-end")`, which appends `/webhook/coziyoo/session-end` to `N8N_HOST`. In parallel, the Python agent builds its own n8n LLM webhook URL through `_resolve_n8n_webhook()` in `entrypoint.py`, which has six separate resolution branches (explicit URL, path starting with http, base URL containing "webhook" in path, base URL with non-root path, env path, fallback `/webhook/{workflowId}`). A third path exists: the admin settings database can override `n8n.baseUrl` per device. If any of these three resolve differently, the LLM calls go to one n8n workflow while session-end events go to another — or to an unreachable URL with no error.

**Why it happens:**
n8n configuration is split across environment variables (`N8N_HOST`, `N8N_LLM_WORKFLOW_ID`, `N8N_LLM_WEBHOOK_PATH`), database (agent settings `ttsConfig.n8n.baseUrl`), and runtime metadata passed through the room token. Developers configure one path and assume the others are consistent.

**How to avoid:**
- Use a single source of truth: `N8N_HOST` for the base, and fixed webhook path patterns. Remove the `/webhook/coziyoo/{toolId}` convention in favour of documented, explicit webhook URLs configured via environment.
- Add a startup diagnostics endpoint (`GET /v1/livekit/diagnostics`) that shows the resolved webhook URLs for both LLM calls and session-end events.
- Log the resolved URL at INFO level every time any n8n call is made.

**Warning signs:**
- n8n receives LLM turn requests but not session-end events, or vice versa.
- HTTP 404 on n8n calls (URL resolves to wrong path).
- LLM calls succeed but session-end calls return `N8N_NOT_CONFIGURED`.

**Phase to address:** Voice session reliability phase — verify n8n URL resolution end-to-end.

---

### Pitfall 3: LiveKit Room Exists But Agent Never Joins — Session Hangs at "Waiting for agent..."

**What goes wrong:**
The API creates a LiveKit room and dispatches the agent via the Python join API (`POST /livekit/agent-session` on port 9000). The mobile client connects to the room immediately. If the Python agent worker is not running, the dispatch call fails but the API may still return the room token to the mobile client (depending on whether the dispatch failure path returns early). The mobile app then waits 30 seconds before showing "Agent Not Available" (per `VoiceSessionScreen.tsx` line 144). In production, this 30-second hang looks like a broken app.

**Why it happens:**
The dispatch to the Python join API is a best-effort fire-and-forward. The API calls `dispatchAgentJoin()` from `apps/api/src/services/livekit.ts`, which forwards to the Python `/livekit/agent-session` endpoint. The mobile `HomeScreen.tsx` has a guard (lines 63-66) checking `data.agent?.dispatched`, but if the dispatch request itself times out or the join API is down, the error handling depends on whether the error propagates correctly through the chain.

**How to avoid:**
- The `AI_SERVER_URL` env var pointing to the Python join API must be set and reachable from the Node API. Validate this at startup.
- The Python worker must be running before any session can succeed. Add a `/health` check for the worker process (not just the FastAPI join endpoint) to the API diagnostics.
- The 10-second `AI_SERVER_TIMEOUT_MS` default is sufficient, but confirm the dispatch error is surfaced as a hard failure to the mobile client, not a soft "agent not dispatched" state.

**Warning signs:**
- Mobile shows "Waiting for agent..." indefinitely.
- API logs show dispatch call timed out or returned non-2xx.
- Python join API `/health` returns 200 but no worker process is running (`python -m voice_agent.entrypoint` not in process list).

**Phase to address:** Voice session startup reliability phase.

---

### Pitfall 4: Log Viewer Reads From a Hardcoded File Path That May Not Exist

**What goes wrong:**
`apps/voice-agent/src/voice_agent/join_api.py` reads the log file from `VOICE_AGENT_REQUEST_LOG_FILE`, defaulting to `/workspace/.runtime/voice-agent-requests.log`. The log viewer at `/logs/viewer` fetches from `/logs/requests`, which reads this file. If the file does not exist, `_read_request_logs()` returns an empty list and the viewer shows "No logs." — which looks identical to the case where there genuinely are no sessions. The file is only created by `_configure_logging()` in `entrypoint.py` when the worker process starts; if the worker is not running, no file exists and the viewer is useless for diagnosing startup failures.

**Why it happens:**
The join API (FastAPI on port 9000) and the worker process (LiveKit Agents) are separate processes. The join API starts with `uvicorn`, the worker starts separately with `python -m voice_agent.entrypoint`. If only the join API is running (e.g., after a partial deploy), the log file does not exist.

**How to avoid:**
- The `/logs/viewer` page should distinguish between "file does not exist" and "file exists but empty". The API already returns `"file": str(request_log_file)` — add a `"fileExists": bool` field so the viewer can display a warning.
- In production, configure a persistent log directory (not `/workspace/.runtime/` which may not persist across container restarts).
- Ensure the systemd service for the voice agent includes `WorkingDirectory` and creates the log directory on first start.

**Warning signs:**
- Log viewer shows "No logs." immediately after a session.
- `VOICE_AGENT_REQUEST_LOG_FILE` path does not exist on disk.
- The join API process is running but the worker process is not.

**Phase to address:** Observability and log viewer fix phase.

---

### Pitfall 5: n8n Session-End Webhook Path is Fixed to `/webhook/coziyoo/session-end` But n8n Workflow Must Be Configured to Listen on That Exact Path

**What goes wrong:**
`sendSessionEndEvent()` in `apps/api/src/services/n8n.ts` hardcodes the webhook path as `/webhook/coziyoo/session-end` (via `resolveToolWebhookEndpoint("session-end")`). For this to work, n8n must have an active workflow with a Webhook trigger node configured with the path `coziyoo/session-end` and the workflow must be activated (not just saved). n8n webhooks only respond when the workflow is in "active" state. A workflow that exists but is inactive returns 404.

**Why it happens:**
n8n has two modes for webhook nodes: "test" (active only when the workflow editor is open) and "production" (active when the workflow is activated via the toggle). Developers test in the editor, the webhook works, then they close the editor and wonder why it stopped. The workflow was never activated.

**How to avoid:**
- Document that the session-end workflow MUST be activated in n8n (green toggle on the workflow list page).
- The `getN8nStatus()` health check only calls `/healthz` and checks workflow accessibility via the management API — it does not verify the webhook is reachable. Add a test-fire to the session-end webhook path during startup health check.
- Store the expected webhook paths in env vars so they can be changed without a code deploy.

**Warning signs:**
- n8n health check returns `reachable: true` but session-end calls return HTTP 404.
- n8n UI shows the workflow exists but the toggle is grey (inactive).
- `sendSessionEndEvent()` logs `HTTP 404` after 3 retry attempts.

**Phase to address:** n8n order creation fix phase.

---

### Pitfall 6: Mobile AudioSession Must Complete Before LiveKit Room Connect — Race Condition on iOS

**What goes wrong:**
`VoiceSessionScreen.tsx` sets `connect={audioReady}` on `LiveKitRoom`, gating connection until `AudioSession.configureAudio()` + `setAppleAudioConfiguration()` + `startAudioSession()` all complete. The `.catch()` handler sets `audioReady = true` even on failure ("Still allow connection even if configuration partially fails" — comment line 63). If iOS audio session configuration fails silently, the microphone may not capture audio even though the room connects and the agent joins. The user sees "Agent is ready" but the agent never hears them.

**Why it happens:**
iOS audio session configuration fails for several reasons: another app holds the audio session, the microphone permission was denied at OS level but the app did not check before calling LiveKit, or `AVAudioSession` is in an incompatible state. The fallback to `setAudioReady(true)` on error prevents a hang but hides the root cause.

**How to avoid:**
- Check microphone permission explicitly before starting the session (`expo-camera` or `expo-av` permission APIs) and surface a clear error if denied.
- Remove the catch-and-continue pattern — or if kept, log the error and show a non-blocking warning to the user that audio may not work.
- Test the session start flow on physical iOS devices, not just simulators (simulators have no real microphone permission flow).

**Warning signs:**
- Room connects successfully, agent joins, but STT receives no audio (log viewer shows no STT requests after session start).
- iOS console logs show AVAudioSession errors.
- Android works but iOS does not.

**Phase to address:** Voice session startup reliability phase.

---

### Pitfall 7: Metadata JSON Passed Through LiveKit Token Is Not Validated Server-Side — Invalid JSON Crashes the Agent

**What goes wrong:**
`livekit.ts` accepts `metadata: z.string().max(2_000)` as a raw string without parsing or validating its JSON structure (noted in `CONCERNS.md`). This metadata string is passed through the LiveKit room token to the Python agent, which parses it as `json.loads(metadata)` in `entrypoint.py` line 1003 and in `VoiceSalesAgent.__init__()` line 47. The Python code handles `json.JSONDecodeError` gracefully — but if the metadata contains structurally valid JSON with missing or wrong-typed fields (e.g., `providers.stt.baseUrl` is an integer instead of a string), `_build_stt()` will call `_normalize_base_url(str(stt_cfg.get("baseUrl") or ""))` which may produce a malformed URL causing the STT connection to fail immediately on session start.

**Why it happens:**
There is no schema validation of the metadata JSON content at the API level. The Python agent defensively accesses nested keys with `.get()` and fallbacks, but incorrect types can produce URLs that look valid but point nowhere.

**How to avoid:**
- Parse and validate metadata JSON on the API side before storing it in the token. Define a TypeScript interface for the expected metadata shape and run `z.parse()` on the parsed object.
- Add an integration test that sends known-bad metadata and verifies the agent starts with sane defaults.

**Warning signs:**
- Agent starts but immediately fails on STT/TTS connection with "invalid URL" errors.
- Log viewer shows no turns at all after a session starts.
- Metadata was recently changed in admin settings.

**Phase to address:** Voice session startup reliability phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| All n8n configuration via env vars without startup validation | Simple deployment | Silent failures when env vars are wrong or missing | Never in production — add startup health checks |
| `_notify_session_end()` catching all exceptions silently | Agent process never crashes | Orders silently lost | Never — should log ERROR and optionally queue for retry |
| Metadata as unvalidated JSON string in LiveKit token | Flexible for admin config changes | Type errors in Python agent that are hard to trace | MVP only — add JSON schema validation when metadata shape stabilizes |
| Single shared secret for all agent-to-API communication | Simple secret management | One compromised secret grants access to all endpoints | Acceptable at current scale; rotate regularly |
| `asyncio.sleep(0.6)` fixed delay in n8n execution API fallback | Avoids race with n8n execution | Will fail for slow n8n workflows; not configurable | Should be replaced with polling with timeout |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| LiveKit agent dispatch | Assuming the agent worker is running because the join API (port 9000) responds | Verify both the FastAPI process AND the `AgentServer` worker are running; they are separate processes |
| n8n webhooks | Configuring webhook in test mode (editor open) and not activating the workflow | Always activate workflows in n8n; test webhooks only respond when editor is open |
| n8n session-end URL | Setting `N8N_HOST` to the webhook URL (e.g., `http://n8n.example.com/webhook/abc`) instead of the base URL | `N8N_HOST` must be the base URL only; the service appends the path |
| LiveKit on Android | Skipping `AndroidAudioTypePresets.communication` — using default audio preset | Voice calls require `communication` audio type for proper echo cancellation and routing |
| LiveKit on iOS | Connecting before `AudioSession.startAudioSession()` completes | Gate `connect` prop on `audioReady` state as already done — do not remove this guard |
| Python voice agent + aiohttp | Creating a new `aiohttp.ClientSession` per request | The `N8nLLM._get_session()` pattern correctly reuses the session — do not change this |
| n8n API key auth | Sending only `x-n8n-api-key` header | n8n Community Edition may require `Authorization: Bearer` header too; the code sends both, which is correct |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No timeout on `sendSessionEndEvent()` fetch calls | API hangs for 60+ seconds if n8n is slow | The existing retry with `SESSION_END_RETRY_BASE_MS` does not set a request timeout — add `AbortController` with 8s timeout per attempt | Any time n8n is slow or stalled |
| `asyncio.sleep(0.6)` before polling n8n execution result | n8n workflow takes > 0.6s; execution result empty | Replace with poll loop with configurable max wait | n8n workflows with any non-trivial LLM calls |
| No request timeout on `fetchN8nUserMemory()` in livekit.ts | Session start hangs if n8n memory endpoint is slow | 2s timeout is already set (line 241 in livekit.ts) — verify it applies correctly | Any time n8n is slow at session start |
| Reading entire log file to serve `/logs/requests` | Log file grows to megabytes; viewer becomes slow | `_read_request_logs()` already limits to `max(limit * 8, 200)` tail lines — adequate, but verify on large log files | After weeks of continuous sessions |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| n8n webhook has no incoming signature validation | n8n → API calls can be spoofed — fake order creation | Add HMAC-SHA256 signature to n8n outgoing webhook and validate in `/session/end` handler |
| `AI_SERVER_SHARED_SECRET` is optional | If omitted, `/v1/livekit/session/end` returns 503 but deployment is not blocked | Make this required in env schema for production deployments |
| Python agent logs may contain user utterances | Voice transcript fragments are stored in the request log file, accessible via the unauthenticated `/logs/viewer` page | Add authentication to the `/logs/viewer` and `/logs/requests` endpoints; the join API currently has no auth on these routes |
| `/logs/clear` deletes log file with no auth | Anyone who can reach port 9000 can clear all voice session logs | Add `x-ai-server-secret` header check to `/logs/clear` and `/logs/requests` endpoints |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 30-second timeout before "Agent Not Available" alert | Users wait 30s on a broken session before getting feedback | Reduce to 10-15 seconds; show a "still connecting..." progress indicator after 5 seconds |
| No feedback during audio session configuration on iOS | App appears frozen for 1-3 seconds before connecting | Show a brief "Preparing audio..." state while `audioReady` is false |
| Session end triggers disconnect which triggers the "Disconnected" alert path before `onEnd()` fires | User may see the disconnect alert AND then navigate away | The `intentionalEnd` ref guard in `VoiceSessionScreen.tsx` handles this correctly — do not remove the ref |
| Agent action banner (add to cart, navigate) disappears after 3.5 seconds with no persistent history | User misses the action if looking away | Log actions to a visible history panel during the session |

---

## "Looks Done But Isn't" Checklist

- [ ] **Session end webhook:** Voice session completes and an order appears in the database — verify by ending a session and checking the orders table, not just the log viewer.
- [ ] **n8n workflow activation:** n8n shows the session-end workflow with a green "Active" indicator, not just that it exists.
- [ ] **Worker process vs. join API:** Both `uvicorn voice_agent.join_api:app` and `python -m voice_agent.entrypoint` are running — the join API alone does not mean the agent will join rooms.
- [ ] **Log file path:** `/workspace/.runtime/voice-agent-requests.log` exists and is writable; the viewer shows real entries, not "No logs." due to missing file.
- [ ] **Shared secret propagation:** `AI_SERVER_SHARED_SECRET` is identical in the root `.env` (consumed by Node API) and the Python agent's settings (consumed by `voice_agent/config/settings.py`); a mismatch returns 401 silently.
- [ ] **n8n base URL format:** `N8N_HOST` contains only the base URL (e.g., `http://n8n.example.com`), not a full webhook URL — the service appends the path.
- [ ] **iOS microphone permission:** App has `NSMicrophoneUsageDescription` in `app.json` / `Info.plist` and the permission is granted on the test device.
- [ ] **Android audio permissions:** `RECORD_AUDIO` permission is in `AndroidManifest.xml` and granted.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Sessions ended without triggering n8n (missed orders) | HIGH | Query `voice_session_logs` table for sessions with no associated orders; manually trigger n8n session-end webhook for each with the room/timestamp data |
| Log file missing, no observability during incident | MEDIUM | Restart the worker process (`systemctl restart coziyoo-voice-agent`); the worker will recreate the log file on first session |
| n8n workflow inactive, all webhooks returning 404 | LOW | Activate workflow in n8n UI; no data loss if sessions are still in the database |
| Shared secret mismatch after key rotation | LOW | Update both `.env` and Python settings, restart both services; no data loss |
| AudioSession failure causing silent mic on iOS | LOW | Stop and restart the audio session; the mobile app reconnects |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| AI_SERVER_SHARED_SECRET misconfiguration | Voice session reliability phase | End a session and verify order appears in database |
| n8n webhook URL resolution divergence | n8n order creation fix phase | Confirm single URL source of truth; log viewer shows n8n requests after every session |
| Agent never joins (worker not running) | Voice session startup reliability phase | Startup health check endpoint returns both join API and worker status |
| Log viewer file missing | Observability phase | Log viewer shows entries after first session without needing restart |
| n8n workflow inactive | n8n order creation fix phase | Health check calls webhook path and verifies 2xx response |
| iOS audio session race condition | Voice session startup reliability phase | Physical device test: session connects and agent receives audio |
| Metadata JSON not validated | Voice session startup reliability phase | Integration test with invalid metadata confirms agent uses safe defaults |
| Unauthenticated log endpoints | Security hardening phase | `/logs/viewer` requires auth; `/logs/clear` requires shared secret |

---

## Sources

- Codebase inspection: `apps/voice-agent/src/voice_agent/entrypoint.py` (session-end flow, n8n URL resolution, audio config)
- Codebase inspection: `apps/voice-agent/src/voice_agent/join_api.py` (log viewer, auth model, worker dispatch)
- Codebase inspection: `apps/api/src/services/n8n.ts` (session-end retry logic, webhook URL construction)
- Codebase inspection: `apps/api/src/routes/livekit.ts` (session/end handler, shared secret validation)
- Codebase inspection: `apps/mobile/src/screens/VoiceSessionScreen.tsx` (audio session gating, agent timeout, disconnect handling)
- Codebase inspection: `apps/mobile/src/screens/HomeScreen.tsx` (session start flow, agent dispatch guard, n8n preflight)
- Codebase inspection: `apps/api/src/config/env.ts` (optional vs required env vars)
- `.planning/codebase/CONCERNS.md` (N8N webhook auth incomplete, metadata validation gap, N8N graceful degradation)
- `.planning/codebase/INTEGRATIONS.md` (service ports, env var inventory, webhook direction)

---

*Pitfalls research for: LiveKit + n8n + Expo voice ordering integration*
*Researched: 2026-03-12*
