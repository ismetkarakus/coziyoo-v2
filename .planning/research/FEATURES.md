# Feature Landscape

**Domain:** Internal voice agent management dashboard
**Researched:** 2026-03-22
**Reference platforms:** vapi.ai dashboard, retell.ai dashboard

## Table Stakes

Features the dashboard must have or it provides no value over the existing VoiceAgentSettingsPage. These are validated requirements from PROJECT.md plus the minimum viable feature set observed across vapi.ai and retell.ai.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Profile list with create/delete** | Core purpose -- manage multiple agent configs side by side | Low | Existing admin page has device-keyed rows (`starter_agent_settings`). New dashboard needs a proper left-sidebar list (vapi pattern). Existing API: `GET/DELETE /admin/livekit/agent-settings` |
| **Profile naming and identification** | Users need to tell profiles apart at a glance (e.g. "Production TR", "Test EN") | Low | Already have `agentName` field in `AgentSettingsFull`. Just needs prominent display |
| **Active profile toggle** | One profile serves all calls -- switching is the core workflow | Low | Already implemented: `POST /admin/livekit/agent-settings/:deviceId/activate` with transaction-based exclusive toggle |
| **LLM/Model configuration** | Without model config the agent cannot reason | Medium | Existing: `ollamaModel`, `systemPrompt`. New dashboard needs: provider dropdown, model selector, base URL, system prompt editor (textarea with line numbers), first message / greeting config. Vapi has: Provider, Model, First Message Mode, First Message, System Prompt with Generate button |
| **System prompt editor** | The most-edited field -- must be a good editing experience | Medium | Existing `systemPrompt` field is a simple text input. New dashboard needs a larger textarea, possibly with token count. Vapi shows a multi-line editor with markdown-like formatting |
| **Greeting / First message config** | Agent needs to know how to start the conversation | Low | Already have `greetingEnabled` (boolean) and `greetingInstruction` (text). Map to vapi's "First Message Mode" + "First Message" pattern |
| **STT configuration** | Agent needs to hear the user | Medium | Existing: multi-server support (`SttServer[]`), provider, baseUrl, transcribePath, model, queryParams, authHeader. New dashboard should surface these as a clean form per the Transcriber tab pattern. Vapi shows: Provider, Language, Model, Background Denoising toggle, Fallback Transcribers |
| **TTS configuration** | Agent needs to speak | Medium | Existing: multi-server support (`TtsServer[]`), baseUrl, synthPath, textFieldName, bodyParams, queryParams, authHeader. Vapi shows: Provider, Custom Voice Server URL, Voice ID, Additional Configuration, Fallback Voices |
| **N8N / Webhook / Tools configuration** | Agent needs to take actions (end-of-call webhook, MCP tools) | Medium | Existing: `N8nServer[]` with baseUrl, webhookPath, mcpWebhookPath. Vapi shows: tagged tool list (n8n badge), Predefined Functions, Custom Functions |
| **Connection testing** | Users must verify servers are reachable before activating a profile | Medium | Already implemented in API: `POST /admin/livekit/test/stt`, `test/tts`, `test/n8n`, `test/livekit`. Must carry forward to new dashboard. Include test-with-sample-audio for STT, test-with-sample-text for TTS |
| **Tab-based config layout** | Each config domain (Model, Voice, Transcriber, Tools) on its own tab | Low | Existing admin page uses `VoiceSettingsTab = "summary" | "stt" | "tts" | "n8n" | "general"`. Vapi uses: Model, Voice, Transcriber, Tools, Analysis, Monitors, Compliance, Advanced. For internal tool, use: Model, Voice, Transcriber, Tools (4 tabs) |
| **Admin JWT authentication** | Dashboard must be access-controlled | Low | Reuse existing admin JWT realm. Login page + token storage + auto-refresh on 401. Existing `apps/admin/src/lib/api.ts` pattern |
| **Save confirmation / error feedback** | Users must know if their changes saved | Low | Toast notifications on save success/failure. Standard UX |

## Differentiators

Features that would set this dashboard apart from the basic admin page it replaces. Not strictly required for launch but significantly improve the ops workflow.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Call logs viewer** | See session history without digging through server logs -- validates that the active profile is working | Medium | PROJECT.md lists this as a requirement. Needs: session list with duration, linked profile, success/failure status, timestamps. Vapi shows: filterable table with Call ID, Assistant, Type, Ended Reason, Success Evaluation, Score, Start Time, Duration, Cost. For internal use, skip Cost/Phone columns |
| **Profile duplication (clone)** | Quickly create variants of a working profile for A/B testing configs | Low | Copy all settings from one profile to a new one with "(copy)" suffix. Very useful for iterating on system prompts |
| **cURL import for servers** | Paste a cURL command, auto-populate server config fields | Low | Already implemented in existing VoiceAgentSettingsPage (`parseCurlCommand`). Port this to new dashboard |
| **Live TTS preview (audio playback)** | Type text, hear the voice -- essential for choosing voice settings | Medium | Existing `POST /admin/livekit/test/tts` returns audio buffer. Dashboard plays it inline. Much faster feedback loop than making a test call |
| **Live STT test (record + transcribe)** | Record a short audio clip, see transcription -- validates STT config | Medium | Existing `POST /admin/livekit/test/stt/transcribe` accepts base64 audio. Dashboard records from mic, sends, shows transcript |
| **Cost and latency indicators** | Know how expensive/fast the current config is | Low | Vapi shows "Cost ~$0.06/min" and "Latency ~1410ms" badges. For self-hosted Ollama/STT/TTS, latency is the useful metric. Measure from test calls |
| **Profile diff / changelog** | See what changed between profile saves | Medium | Internal audit trail. Store previous config snapshots, show diff. Useful when "it was working yesterday" |
| **Default server selection** | Mark one STT/TTS/N8N server as "default" within a profile's multi-server list | Low | Existing data model has `defaultSttServerId`, `defaultTtsServerId`, `defaultN8nServerId`. Surface this in UI |
| **Model list auto-discovery** | Fetch available models from Ollama's `/api/tags` endpoint | Low | Existing `ServerDraft` has `modelsPath` field. Auto-populate model dropdown from the configured LLM server |
| **Dark mode** | Vapi uses dark theme, team may expect it | Low | Use shadcn/ui or similar with dark mode support. Vapi's dark theme is the reference |

## Anti-Features

Features to explicitly NOT build. This is an internal ops tool for a small team, not a SaaS platform.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Multi-tenant / team management** | Only the internal team uses this. No need for user roles, team invites, or per-user permissions | Single admin JWT realm. Everyone who can log in has full access |
| **Phone number management** | Coziyoo uses LiveKit rooms, not telephony. No phone numbers involved | N/A -- calls come through the mobile app via LiveKit |
| **Billing / usage metering** | Self-hosted infrastructure (Ollama, custom STT/TTS). No per-minute costs to track | If cost tracking becomes useful later, add it as a simple read-only metric, not a billing system |
| **Flow/conversation designer** | Vapi has "Flow Studio" for branching conversation flows. Overkill for a food ordering agent with a single linear flow | System prompt is the conversation design tool. Keep it simple |
| **Automated evaluation / testing suites** | Vapi offers automated eval against expected behaviors. Premature for a team of this size | Manual test calls from the dashboard are sufficient. Add automated testing only if the team grows |
| **Compliance / HIPAA controls** | Not handling medical or financial data. Food orders do not require compliance frameworks | N/A |
| **Analytics boards / custom dashboards** | Vapi's "Boards" feature is for SaaS customers tracking KPIs across many agents. Internal team needs call logs, not BI | Call logs with basic filtering are sufficient |
| **Real-time call monitoring / live listen-in** | Explicitly out of scope per PROJECT.md. Complex to build (LiveKit room joining + audio streaming) | Call logs after the fact are sufficient |
| **Webhook signature verification UI** | SaaS platforms need this for customer security. Internal tool talks to its own N8N instance | Shared secret in env is sufficient |
| **API key management** | No external consumers of this dashboard's API | Admin JWT is the only auth mechanism needed |
| **Fallback provider chains** | Vapi supports fallback transcribers/voices if primary fails. Multi-server list already provides this implicitly | Users can configure multiple servers and mark one as default. No automatic failover logic needed in the dashboard |
| **Version history / rollback** | Profile diff is a nice-to-have; full version history with one-click rollback is overengineering | If needed, clone the profile before making changes |
| **Squads / multi-agent orchestration** | Vapi supports "Squads" (multiple assistants coordinating). Coziyoo has one agent type | Single-agent model is correct for this use case |

## Feature Dependencies

```
Admin JWT Auth ─────────────> All dashboard features
Profile CRUD ───────────────> Active profile toggle
Profile CRUD ───────────────> LLM config, STT config, TTS config, Tools config
LLM config ─────────────────> System prompt editor
LLM config ─────────────────> Greeting / first message config
STT config ─────────────────> STT connection test
TTS config ─────────────────> TTS connection test / audio preview
Tools config ───────────────> N8N connection test
Profile CRUD + Active toggle > Call logs (logs reference which profile was active)
```

## MVP Recommendation

Prioritize for launch (Phase 1):

1. **Admin JWT login** -- gate everything behind auth
2. **Profile list + CRUD** -- create, read, update, delete profiles in left sidebar
3. **Active profile toggle** -- the core "switch" workflow
4. **4-tab config layout** -- Model | Voice | Transcriber | Tools
5. **LLM config** (provider, model, base URL, system prompt, greeting)
6. **STT config** (provider, base URL, model, language, auth)
7. **TTS config** (provider, base URL, voice ID, body params, auth)
8. **Tools/N8N config** (webhook URLs)
9. **Connection testing** for all providers
10. **Save with toast feedback**

Defer to Phase 2:

- **Call logs viewer** -- requires new API endpoints for session storage, can ship after profile management works
- **Profile duplication** -- trivial to add once CRUD is solid
- **cURL import** -- port existing code, but not blocking
- **Live TTS/STT preview** -- test endpoints exist, but UI takes time
- **Cost/latency indicators** -- nice polish, not blocking
- **Model auto-discovery** -- nice UX improvement
- **Dark mode** -- CSS concern, can be added anytime

Defer indefinitely:

- **Profile diff/changelog** -- only if "what changed?" becomes a real pain point
- All anti-features listed above

## Existing Capabilities to Preserve

The new dashboard must not lose capabilities that the current `VoiceAgentSettingsPage` already provides:

| Current Capability | Where It Lives | New Dashboard Status |
|-------------------|----------------|---------------------|
| Multi-server STT/TTS/N8N lists | `sttServers[]`, `ttsServers[]`, `n8nServers[]` in ttsConfig JSON | Must carry forward |
| cURL command parsing | `parseCurlCommand()` in VoiceAgentSettingsPage | Port to new dashboard (Phase 2) |
| Connection testing (LiveKit, STT, TTS, N8N) | `POST /admin/livekit/test/*` endpoints | Must carry forward (Phase 1) |
| Default server selection | `defaultSttServerId`, `defaultTtsServerId`, `defaultN8nServerId` | Must carry forward |
| Key-value param editors (query params, body params) | Inline editors in VoiceAgentSettingsPage | Must carry forward |
| Profile activation (exclusive toggle) | `POST /admin/livekit/agent-settings/:deviceId/activate` | Must carry forward (Phase 1) |
| System prompt + greeting config | `systemPrompt`, `greetingEnabled`, `greetingInstruction` | Must carry forward (Phase 1) |
| STT live transcription test | `POST /admin/livekit/test/stt/transcribe` | Port to new dashboard (Phase 2) |
| TTS audio playback test | `POST /admin/livekit/test/tts` returns audio | Port to new dashboard (Phase 2) |

## Sources

- vapi.ai dashboard screenshots (local: `voice-dashboard-snaphots/`)
- [Vapi Assistant API Reference](https://docs.vapi.ai/api-reference/assistants/create)
- [Vapi Assistants Quickstart](https://docs.vapi.ai/assistants/quickstart)
- [Retell AI Review 2026](https://www.retellai.com/blog/vapi-ai-review)
- [Retell AI Changelog](https://www.retellai.com/changelog)
- Existing codebase: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx`, `apps/admin/src/types/voice.ts`, `apps/api/src/routes/admin-livekit.ts`, `apps/voice-agent/src/voice_agent/entrypoint.py`
