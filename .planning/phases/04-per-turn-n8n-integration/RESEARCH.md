# Phase 4: Per-Turn N8N Integration - Research

**Researched:** 2026-03-14
**Domain:** N8N webhook integration, voice agent LLM pipeline, shared secret authentication
**Confidence:** HIGH — all findings are from direct source inspection of the codebase

---

## Summary

Phase 4 is about hardening the existing per-turn N8N pipeline: enforcing
`AI_SERVER_SHARED_SECRET` at startup, consolidating the competing webhook URL
resolution logic, ensuring the n8n workflow uses the "Respond to Webhook"
node, and verifying that the voice agent correctly speaks the `replyText` it
receives.

The key insight is that **most of the plumbing already exists** but has
soft/optional failure modes. `AI_SERVER_SHARED_SECRET` is `.optional()` in the
API schema and defaults to `""` in Python settings — neither side crashes on
startup without it. The webhook URL resolution has two competing code paths
(API-side `resolveProviders` + Python `_resolve_n8n_webhook`) with at least
three env var inputs (`N8N_HOST`, `N8N_LLM_WEBHOOK_PATH`, `N8N_LLM_WEBHOOK_URL`)
that can produce different results. The response-parsing is fully implemented
and prioritises `replyText` correctly — that part is fine. The execution API
fallback path in the voice agent (`_run_execution_api`) is async/polling and
will time out under heavy load, but the webhook path is the primary route.

**Primary recommendation:** Make the secret required (not optional) in both
places, then audit the URL resolution chain from API settings to Python
`_resolve_n8n_webhook` so they produce the same URL, and verify the n8n
workflow is configured with "Respond to Webhook" (not "Execute Workflow").

---

## Key Findings Per Plan

### 04-01: Make AI_SERVER_SHARED_SECRET Required

**Current API state (apps/api/src/config/env.ts line 39):**
```typescript
AI_SERVER_SHARED_SECRET: z.string().min(16).optional(),
```
It is `.optional()`. The Zod parse at startup will succeed even if the var is
absent. The API only rejects requests at the per-route level (HTTP 503) for
`/agent-token`, `/session/end`, and `/v1/voice/foods`. All three routes have
identical guard patterns:
```typescript
if (!env.AI_SERVER_SHARED_SECRET) {
  return res.status(503).json({ error: { code: "AI_SERVER_SHARED_SECRET_MISSING", ... } });
}
```
There is no startup-time fail-fast.

**Current voice agent state (apps/voice-agent/src/voice_agent/config/settings.py):**
```python
ai_server_shared_secret=os.getenv("AI_SERVER_SHARED_SECRET", ""),
```
The `Settings` dataclass uses an empty string as the default. `get_settings()`
is called at module import time (line 42 in entrypoint.py, line 17 in
join_api.py). No validation is done on the value — an empty string is silently
accepted.

The voice agent's join endpoint (`join_api.py` line 451) does raise HTTP 503
if the secret is empty at request time, but does not crash the process at
startup.

**How `_notify_session_end` handles a missing secret:**
```python
if not api_base_url or not shared_secret:
    logger.warning("Session end not reported: API_BASE_URL or AI_SERVER_SHARED_SECRET not configured")
    return
```
Silent skip instead of hard failure.

**What startup validation needs to do:**
- API: Change `z.string().min(16).optional()` to `z.string().min(16)` and add
  the var to the required set so the Zod parse at startup rejects the process.
- Voice agent: After `get_settings()`, validate `settings.ai_server_shared_secret`
  is non-empty (and ideally `len >= 16`) and call `sys.exit(1)` with a clear
  message if not.

**Where to add voice agent validation:** `entrypoint.py` `main()` function
and `join_api.py` application startup (FastAPI lifespan or module-level guard
before `app` creation).

---

### 04-02: Audit and Consolidate N8N Webhook URL Resolution

There are two independent code paths that resolve the n8n LLM webhook URL.
They share inputs but can produce different URLs in edge cases.

**Path A — API side (`apps/api/src/services/resolve-providers.ts`):**
Priority chain for the n8n `baseUrl`:
1. `n8nServers[defaultN8nServerId].baseUrl` (from DB `tts_config_json`)
2. Fallback to `legacyN8n.baseUrl` (from `tts_config_json.n8n.baseUrl`)
3. Then `env.N8N_HOST`

Priority chain for `webhookPath`:
1. `defaultN8nServer.webhookPath`
2. `env.N8N_LLM_WEBHOOK_PATH` (which defaults to `""` in env schema)

The resolved `n8n` object is then serialised into `agentMetadata` JSON and
passed to the voice agent via the LiveKit dispatch metadata field.

**Path B — Voice agent side (`apps/voice-agent/src/voice_agent/entrypoint.py`):**
`_resolve_n8n_webhook` (lines 441–477) takes:
- `n8n_base_url` (from `providers.n8n.baseUrl`)
- `workflow_id` (from `providers.n8n.workflowId` or `N8N_LLM_WORKFLOW_ID` env)
- `webhook_path` (from `providers.n8n.webhookPath`)
- `webhook_url` (from `providers.n8n.webhookUrl`)

It also reads two env vars **independently**, potentially overriding what the
API sent:
- `os.getenv("N8N_LLM_WEBHOOK_URL", "")` — if set, takes absolute priority
- `os.getenv("N8N_LLM_WEBHOOK_PATH", "")` — used as path if no explicit path

**Competing inputs that can cause drift:**
| Input | API resolves | Voice agent reads independently |
|-------|-------------|--------------------------------|
| `N8N_HOST` | Yes, as fallback | Yes, via `os.getenv("N8N_HOST")` |
| `N8N_LLM_WEBHOOK_PATH` | Yes, stored in metadata | Yes, via `os.getenv` in `_resolve_n8n_webhook` |
| `N8N_LLM_WEBHOOK_URL` | Not read | Yes, takes absolute priority |

**Potential divergence scenario:** If `N8N_LLM_WEBHOOK_URL` is set in the
voice agent's environment but not in the API's environment, the voice agent
will call a different URL than the API expects. The API has no awareness of
`N8N_LLM_WEBHOOK_URL` at all.

**The `baseUrl` has-webhook-path heuristic (lines 457–466):** If the
`n8n_base_url` already contains the word `"webhook"` in its path, the function
treats it as a full webhook URL and skips path construction. This produces
unexpected results if the stored base URL is something like
`https://n8n.example.com` which might be coincidentally stored with a
`/webhook/` prefix.

**Default webhook path construction:**
If no path is configured, the default is `/webhook/{workflow_id}` (line 472).
This is the standard n8n path for test (non-production) webhooks. The
production n8n path would be `/webhook/{workflow_id}` without the `/test/`
prefix, which is correct.

**Startup diagnostic logging needed:** Neither side logs the resolved
webhook URL at startup in a way that is easy to find. The voice agent logs it
at the start of each job (`logger.info("Using N8N LLM webhook: %s workflow=%s",
...`)` in `_build_llm`) but only after dispatch, not at worker boot.

---

### 04-03: N8N "Respond to Webhook" Node Configuration

**The 60-second timeout problem:** n8n webhooks have a hard 60-second response
timeout. Standard "Execute Workflow" triggers in n8n start a workflow but do
not wait for it to complete before responding. If the LLM call inside n8n takes
more than 60 seconds, the webhook returns a timeout error and the voice agent
raises `APIConnectionError`.

**The "Respond to Webhook" node:** n8n provides a dedicated node that allows
a workflow to explicitly send a response back to the webhook caller before the
workflow exits. When a workflow has a "Respond to Webhook" node, the webhook
trigger holds the HTTP connection open until that node fires (or until the
60-second timeout).

**How the voice agent receives the reply:** `N8nLLMStream._run_webhook` (lines
626–653) reads the HTTP response body synchronously after the POST. It calls
`_extract_n8n_answer(parsed)` which checks keys in order:
```python
for key in ("replyText", "answer", "text", "output", "message"):
    value = body.get(key)
    if isinstance(value, str) and value.strip():
        return value.strip()
```
Then falls back to checking `body.get("data")` for the same keys. If that
also fails, it calls `_deep_find_answer` which recursively searches the entire
response tree. This is robust. Any of these shapes will work:
- `{ "replyText": "..." }` — preferred
- `{ "answer": "..." }`
- `{ "data": { "text": "..." } }`

**The execution API fallback (`_run_execution_api`):** This path creates an
execution via `POST /api/v1/executions`, waits 600ms, then fetches the result
via `GET /api/v1/executions/{id}?includeData=true`. This is unreliable for
per-turn latency because: (a) there is no polling loop — it fetches exactly
once after the initial sleep, (b) if the LLM takes more than 600ms the
execution may not be complete, and (c) it requires `N8N_API_KEY` to be set.
The webhook path is the correct path. The execution API fallback should not
be relied on for per-turn flow.

**Expected n8n workflow structure:**
1. Webhook trigger node (HTTP POST, path `/webhook/{workflow_id}`)
2. LLM node (e.g., OpenAI, Ollama, or AI Agent node)
3. "Respond to Webhook" node — sends `{ "replyText": "..." }` back
4. Workflow continues for any async work (logging, session state, etc.)

**Session state in n8n:** The payload sent by the voice agent includes:
```python
{
    "workflowId": ...,
    "roomId": ...,
    "jobId": ...,
    "deviceId": ...,
    "userText": ...,
    "messages": [...],  # full chat history, last 24 messages
    "systemPrompt": ...,
    "locale": ...,
}
```
The `messages` array contains the full conversation history from the agent's
in-memory `chat_ctx`. This means n8n does not need to maintain separate session
state — the history is always sent with each turn. n8n can use the `roomId` or
`jobId` as a session identifier if it needs to store anything outside the message
history.

---

### 04-04: End-to-End Per-Turn Flow Verification

**Full per-turn flow (current):**
1. Mobile user speaks → VAD (Silero) detects end of utterance
2. Voice agent's STT provider transcribes the audio → `userText`
3. `AgentSession` calls `N8nLLM.chat()` → creates `N8nLLMStream`
4. `N8nLLMStream._run()` extracts `user_text` from `chat_ctx`, builds payload,
   POSTs to the resolved n8n webhook endpoint
5. If webhook succeeds: `_extract_n8n_answer` parses the response, emits
   `llm.ChatChunk` with the reply text
6. If webhook fails: falls back to `_run_execution_api` (unreliable)
7. `AgentSession` synthesises the reply text via TTS and publishes audio to
   the LiveKit room

**Session ID situation:** The voice agent does not send a separate `sessionId`
field. Instead it sends `roomId` (the LiveKit room name) and `jobId` (the
LiveKit job ID). Both are stable for the lifetime of a session. The `roomId`
is the most reliable identifier since it is set from the moment the room is
created. n8n can use `roomId` as the session key for any session-scoped state.

**What "verify end-to-end" requires:**
- n8n responds before the voice agent's `conn_options.timeout`
- The `conn_options.timeout` for `N8nLLMStream` comes from LiveKit's
  `APIConnectOptions` which defaults to `DEFAULT_API_CONNECT_OPTIONS`
  (the exact value is not in this codebase — it is set by `livekit-agents`)
- The n8n "Respond to Webhook" node must fire within the n8n 60-second limit

---

## Standard Stack (Libraries Already in Use)

### API side
| Library | Version | Purpose |
|---------|---------|---------|
| `zod` | in package.json | Env schema validation at startup |
| `node:crypto` | built-in | Timing-safe shared secret comparison |
| `express` | in package.json | Route handlers |

### Voice agent side
| Library | Version | Purpose |
|---------|---------|---------|
| `aiohttp` | in pyproject.toml | Async HTTP client for n8n webhook calls |
| `livekit-agents` | in pyproject.toml | `LLM`, `LLMStream`, `AgentSession` base classes |
| `python-dotenv` | in pyproject.toml | `.env` loading in `settings.py` |

---

## Implementation Patterns

### Pattern: Startup Validation in API (Zod)

Making a field required in the existing schema requires removing `.optional()`:
```typescript
// Before (env.ts line 39):
AI_SERVER_SHARED_SECRET: z.string().min(16).optional(),

// After:
AI_SERVER_SHARED_SECRET: z.string().min(16),
```
The `parsed.success` check at line 93 already calls `process.exit(1)` on
failure, so no additional code is needed — the schema change alone provides
fail-fast behaviour.

### Pattern: Startup Validation in Python (voice agent)

The existing settings module has no validation. The `main()` function in
`entrypoint.py` (line 1150) calls `_configure_logging()` then `cli.run_app()`.
The `get_settings()` call is at module level (line 42), so validation should
be added in `main()` after `_configure_logging()`:
```python
def main() -> None:
    _configure_logging()
    if not settings.ai_server_shared_secret or len(settings.ai_server_shared_secret) < 16:
        logger.critical("AI_SERVER_SHARED_SECRET is required (min 16 chars). Refusing to start.")
        sys.exit(1)
    _start_worker_heartbeat()
    cli.run_app(server)
```
The same guard should be added in `join_api.py` (FastAPI startup event or
module-level guard) since it is a separate process.

### Pattern: N8N Webhook URL — Single Canonical Path

The cleanest fix is to add a new env var `N8N_LLM_WEBHOOK_URL` to the API's
env schema (it is already read by the voice agent) so both sides can be
configured with an absolute URL that bypasses all path-construction logic:
```typescript
N8N_LLM_WEBHOOK_URL: z.string().url().optional(),
```
Then pass it through `resolveProviders` into the metadata, and in the voice
agent, let the explicit `N8N_LLM_WEBHOOK_URL` env var (already read at line
447) take priority. This makes the voice agent's effective URL transparent
and matchable from the API side.

Alternatively, add startup diagnostic logging that prints the resolved webhook
URL immediately when the worker starts so operators can verify both sides agree.

### Pattern: Shared Secret Header

Both the API and voice agent already use the `x-ai-server-secret` header
consistently:
- API sends it in `dispatchAgentJoin` (livekit.ts service line 136)
- API validates it in route handlers via `isValidSharedSecret(provided)`
  (constant-time comparison with `crypto.timingSafeEqual`)
- Voice agent validates it in `join_api.py` line 453
- Voice agent sends it in `_notify_session_end` (entrypoint.py line 1041)

This pattern is already correct and consistent. No changes needed to the
header name or validation logic.

---

## Risks / Pitfalls

### Pitfall 1: Making AI_SERVER_SHARED_SECRET Required Breaks Existing Deployments

**What goes wrong:** If any existing production `.env` file omits
`AI_SERVER_SHARED_SECRET`, the API will refuse to start after the change.
**Root cause:** The secret has been optional since it was added.
**How to avoid:** Add a migration note in the deploy docs. The `.env.example`
in the voice agent already has `AI_SERVER_SHARED_SECRET=change_me_strong_secret`
— verify the API's `.env.example` also has it.

### Pitfall 2: Voice Agent Execution API Fallback Silently Masks Webhook Failures

**What goes wrong:** If the n8n webhook is misconfigured, the voice agent
silently falls back to `_run_execution_api`. This path polls once after 600ms
and may return empty results if the workflow is still running, producing an
`APIConnectionError("n8n execution result missing answer text")`.
**Root cause:** The fallback exists as a "belt and suspenders" measure but
hides the real problem (broken webhook config).
**How to avoid:** Add explicit logging when the webhook path fails and the
fallback is triggered. Consider disabling the fallback if `N8N_LLM_WEBHOOK_URL`
is explicitly configured (since an explicit URL means the operator knows what
they want).

### Pitfall 3: N8N "Respond to Webhook" vs "Execute Workflow" Node Confusion

**What goes wrong:** If the n8n workflow uses the standard workflow trigger
(not webhook) or does not include a "Respond to Webhook" node, the webhook
POST will return immediately with `{ "executionId": "..." }` or an empty 200,
and `_extract_n8n_answer` will find no answer text, then raise
`APIConnectionError("n8n webhook returned empty answer")`.
**Root cause:** n8n has two different webhook behaviours: fire-and-forget
(returns immediately) and respond-inline (holds connection until "Respond to
Webhook" node fires).
**Warning sign:** `N8N response path=webhook error=n8n webhook returned empty answer`
in the voice agent request log.

### Pitfall 4: n8n 60-Second Webhook Timeout

**What goes wrong:** If the LLM call within n8n takes more than 60 seconds,
n8n closes the connection and returns a timeout error before the "Respond to
Webhook" node fires.
**Root cause:** n8n has a hard 60-second limit on webhook responses. This is
not configurable on a per-workflow basis in self-hosted n8n without changing
server-side config.
**How to avoid:** Keep the LLM call fast (use a lightweight model or set a
short LLM timeout inside the n8n workflow). Monitor n8n execution times.

### Pitfall 5: `_resolve_n8n_webhook` "baseUrl has webhook path" Heuristic

**What goes wrong:** If someone stores a base URL like
`https://n8n.example.com/webhook/` (with a trailing webhook path) as the
`n8n.baseUrl` in device settings, the heuristic on line 457 kicks in and uses
the base URL directly, ignoring the `workflow_id`. This results in a broken URL.
**Root cause:** The heuristic checks `"webhook" in parsed_base.path.lower()`
to detect if the base URL is already a full webhook URL.
**How to avoid:** When consolidating URL resolution, document the expected
format for `n8n.baseUrl` (should be the n8n host root, not a webhook path).

### Pitfall 6: Python `settings.py` Is Not the Only Source of N8N Config in Voice Agent

**What goes wrong:** The voice agent's `settings.py` only stores LiveKit
credentials and `AI_SERVER_SHARED_SECRET`. All n8n configuration comes from the
job metadata dispatched by the API (the `providers` object). If the API's
`resolveProviders` returns `null` for `n8n.baseUrl`, the voice agent falls back
to `os.getenv("N8N_HOST")` independently — but `N8N_HOST` may not be in the
voice agent's environment (it is an API env var).
**How to avoid:** Confirm that the voice agent's `.env.example` and deployment
config include `N8N_HOST` (or `N8N_LLM_WEBHOOK_URL`) if the DB-stored settings
are not configured.

---

## Sources

### Primary (HIGH confidence — direct source inspection)
- `/Users/drascom/Work/coziyoo-v2/apps/api/src/config/env.ts` — AI_SERVER_SHARED_SECRET schema, N8N env vars
- `/Users/drascom/Work/coziyoo-v2/apps/api/src/services/n8n.ts` — resolveToolWebhookEndpoint, runN8nToolWebhook, sendSessionEndEvent
- `/Users/drascom/Work/coziyoo-v2/apps/api/src/routes/livekit.ts` — isValidSharedSecret, per-route secret guards, session/end handler
- `/Users/drascom/Work/coziyoo-v2/apps/api/src/services/resolve-providers.ts` — full n8n URL resolution chain
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/src/voice_agent/entrypoint.py` — N8nLLM, N8nLLMStream, _resolve_n8n_webhook, _extract_n8n_answer, _deep_find_answer, _build_llm
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/src/voice_agent/config/settings.py` — Settings dataclass, get_settings()
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/src/voice_agent/join_api.py` — join_agent_session secret validation
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/src/voice_agent/session/end_session.py` — send_session_end
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/tests/test_n8n_helpers.py` — test coverage for _extract_n8n_answer priority
- `/Users/drascom/Work/coziyoo-v2/apps/voice-agent/.env.example` — voice agent env vars

---

## Metadata

**Confidence breakdown:**
- AI_SERVER_SHARED_SECRET current state: HIGH — read directly from source
- N8N URL resolution paths: HIGH — traced through both codebases
- Response parsing: HIGH — both implementation and tests read
- n8n "Respond to Webhook" behaviour: MEDIUM — standard n8n documentation knowledge; actual workflow JSON not inspected (workflows/ dir has JSONs but their trigger node types were not verified)
- Voice agent timeout value: LOW — `DEFAULT_API_CONNECT_OPTIONS` is from `livekit-agents` library, not in this codebase

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable codebase, no fast-moving dependencies for this phase)
