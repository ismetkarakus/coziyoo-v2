# Phase 2: Profile Management - Research (Pivoted)

**Researched:** 2026-03-22  
**Domain:** FastAPI + Jinja2 + HTMX dashboard in `apps/voice-agent`, backed by existing Express admin APIs  
**Confidence:** HIGH

## Summary

Phase 2 must now be implemented as a server-rendered dashboard inside `apps/voice-agent` (FastAPI), not as a standalone Next.js app.  
The backend profile source of truth is already implemented in Express (`/v1/admin/agent-profiles` CRUD + activate + duplicate) and should remain unchanged.

The most robust architecture is a **BFF-style FastAPI UI layer**:

1. Browser talks only to FastAPI dashboard routes (same origin, no CORS issues).
2. FastAPI talks server-to-server to Express API (`https://api.coziyoo.com` or env `API_BASE_URL`) with admin bearer token.
3. FastAPI stores access/refresh tokens in secure cookies and performs refresh flow through `/v1/admin/auth/refresh`.
4. HTMX drives partial updates for sidebar/profile tabs to keep implementation lean and testable.

This avoids repeating the recent browser-side CORS failures and keeps auth logic centralized server-side.

<phase_requirements>
## Phase Requirements Mapping

| ID | Requirement | Pivot Implementation |
|----|-------------|----------------------|
| PROF-01..06 | Profile CRUD + active indicator | HTMX sidebar + FastAPI proxy handlers to `/v1/admin/agent-profiles*` |
| MODEL-01..07 | LLM/system/greeting config | Model tab form bound to JSON payload mapped to `llm_config` + scalar fields |
| VOICE-01..06 | TTS config + playback test | Voice tab form + FastAPI route proxying `/v1/admin/livekit/test/tts` and streaming audio response |
| STT-01..06 | STT config + mic transcription | Transcriber tab + record/upload to FastAPI route proxying `/v1/admin/livekit/test/stt/transcribe` |
| TOOLS-01..05 | N8N config + cURL import | Tools tab + parser util + route to `/v1/admin/livekit/test/n8n` |
</phase_requirements>

## Standard Stack

### Required Runtime

| Component | Use |
|-----------|-----|
| FastAPI (existing) | UI pages + HTMX endpoints + auth cookie session handling |
| Jinja2 templates | Server-rendered profile pages and tab partials |
| HTMX | Partial form submits, sidebar refresh, in-place status updates |
| aiohttp or httpx (already used in voice-agent) | Server-side calls from FastAPI to Express API |

### Existing Backend APIs to Reuse (Do Not Rebuild)

| API | Status |
|-----|--------|
| `POST /v1/admin/auth/login` | exists |
| `POST /v1/admin/auth/refresh` | exists |
| `GET /v1/admin/auth/me` | exists |
| `GET/POST/PUT/DELETE /v1/admin/agent-profiles` | exists |
| `POST /v1/admin/agent-profiles/:id/activate` | exists |
| `POST /v1/admin/agent-profiles/:id/duplicate` | exists |
| `POST /v1/admin/livekit/test/{llm,tts,stt,stt/transcribe,n8n}` | exists |

## Architecture Patterns

### Pattern 1: FastAPI BFF for Zero-CORS Browser

- Browser never calls `https://api.coziyoo.com` directly.
- Browser calls `/{dashboard}/...` on same FastAPI origin.
- FastAPI attaches bearer token server-side and forwards request to Express.

Recommended session cookies:
- `coziyoo_admin_at` (access token, HttpOnly, Secure in prod, SameSite=Lax)
- `coziyoo_admin_rt` (refresh token, HttpOnly, Secure in prod, SameSite=Lax)

### Pattern 2: Split Full Page vs Partial Endpoints

- Full page endpoints: login page, profiles page, profile detail page.
- Partial endpoints: sidebar list, tab panel body, form save result badges.
- HTMX triggers:
  - `hx-get` for tab switch.
  - `hx-post` for save/test actions.
  - `hx-swap="outerHTML"` for list row updates.

### Pattern 3: Single Profile Payload Shape

Keep one canonical UI model matching Express `agent_profiles`:

```json
{
  "name": "Profile A",
  "speaks_first": false,
  "system_prompt": "",
  "greeting_enabled": true,
  "greeting_instruction": "",
  "voice_language": "tr",
  "llm_config": {},
  "stt_config": {},
  "tts_config": {},
  "n8n_config": {}
}
```

Forms should map nested key-value editors into these JSON objects before PUT/POST.

## Implementation Blueprint

### 1) Add Dashboard Route Surface in `join_api.py`

Add routes under a clear prefix, e.g.:
- `GET /dashboard/login`
- `POST /dashboard/login`
- `POST /dashboard/logout`
- `GET /dashboard/profiles`
- `GET /dashboard/profiles/{id}`
- `POST /dashboard/profiles`
- `POST /dashboard/profiles/{id}/save`
- `POST /dashboard/profiles/{id}/activate`
- `POST /dashboard/profiles/{id}/duplicate`
- `POST /dashboard/profiles/{id}/delete`
- `POST /dashboard/test/{llm|tts|stt|n8n}`

### 2) Add Template Structure

Recommended layout:

```
apps/voice-agent/src/voice_agent/templates/
  base.html
  login.html
  profiles/
    index.html
    _sidebar.html
    _editor_model.html
    _editor_voice.html
    _editor_transcriber.html
    _editor_tools.html
    _toast.html
```

### 3) Add BFF Client Helpers

Create a small module (e.g. `dashboard_api.py`) with:
- `api_request(method, path, access_token, json=None, files=None)`
- `refresh_access_token(refresh_token)`
- `ensure_authenticated(request)` helper returning valid access token or redirect response.

### 4) Keep API Ownership in Express

Do not move profile business logic to FastAPI.  
FastAPI should orchestrate UX only:
- shape/validate form input
- proxy to Express
- render response partials

## Don't Hand-Roll

- Do not re-implement JWT verification in FastAPI if Express already verifies bearer tokens.
- Do not duplicate profile CRUD SQL in Python.
- Do not build custom browser-side fetch auth logic that bypasses BFF.
- Do not build custom cURL parser from scratch; port the existing parser behavior as utility logic.

## Common Pitfalls

1. **Direct browser calls to API cause CORS failures**
- Root cause already observed from `http://localhost:3001` to `https://api.coziyoo.com`.
- Fix: always same-origin browser calls to FastAPI.

2. **Token refresh race conditions**
- If multiple HTMX requests fail with 401 simultaneously, refresh can race.
- Fix: serialize refresh in FastAPI session helper (per-request lock or single refresh path).

3. **Nested config form field loss**
- HTMX partial swap can drop unsaved tab state.
- Fix: submit full profile payload or persist hidden serialized JSON between tab swaps.

4. **Audio response handling with HTMX**
- TTS test returns audio bytes, not HTML.
- Fix: expose dedicated route returning audio and render `<audio src="/dashboard/test/tts/audio?...">`.

5. **Mic upload encoding mismatch for STT test**
- STT endpoint expects base64 audio payload in existing API contract.
- Fix: convert recorded blob to base64 in browser before POST to FastAPI test endpoint.

## Code Examples

### FastAPI login proxy (concept)

```python
@app.post("/dashboard/login")
async def dashboard_login(request: Request):
    form = await request.form()
    email = str(form.get("email") or "").strip()
    password = str(form.get("password") or "")
    # POST /v1/admin/auth/login -> set HttpOnly cookies -> redirect /dashboard/profiles
```

### HTMX save form (concept)

```html
<form
  hx-post="/dashboard/profiles/{{ profile.id }}/save"
  hx-target="#save-status"
  hx-swap="outerHTML">
  <!-- fields -->
  <button type="submit">Save</button>
</form>
<div id="save-status"></div>
```

### Activate action (concept)

```html
<button
  hx-post="/dashboard/profiles/{{ profile.id }}/activate"
  hx-target="#profiles-sidebar"
  hx-swap="outerHTML">
  Activate
</button>
```

## Verification Strategy

### Automated

- API tests already cover profile CRUD and LLM test route in `apps/api`.
- Add FastAPI tests (pytest) for:
  - login/logout cookie flow
  - unauthorized redirect behavior
  - profile list/detail render when API returns data
  - save/activate/duplicate/delete HTMX handlers

### Manual UAT

1. Login from dashboard page.
2. Create profile, edit all tabs, save, reload.
3. Activate profile and verify sidebar marker.
4. Run LLM/TTS/STT/N8N tests and verify feedback.
5. Duplicate and delete non-active profile.
6. Import via cURL and confirm fields auto-populate.

## Recommended Next Plan Split

1. **Plan A:** FastAPI dashboard shell + auth session proxy + profiles sidebar/list.
2. **Plan B:** 4-tab editor forms (Model/Voice/Transcriber/Tools) with save wiring.
3. **Plan C:** Connectivity tests + cURL import + verification hardening.

This split preserves momentum and isolates the highest-risk part first (auth/BFF).

