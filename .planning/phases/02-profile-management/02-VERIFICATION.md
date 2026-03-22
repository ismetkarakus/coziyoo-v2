---
phase: 02-profile-management
verified: 2026-03-22T16:26:16Z
status: gaps_found
score: 3/5 must-haves verified
gaps:
  - truth: "User can mark a profile as active, see the visual indicator in the sidebar, and verify that the next voice call uses that profile's config"
    status: partial
    reason: "Activation and sidebar indicator exist, but voice-call runtime is not wired to read active agent_profiles configuration."
    artifacts:
      - path: "apps/voice-dashboard/src/components/profile-sidebar.tsx"
        issue: "Activation UI exists and calls /v1/admin/agent-profiles/:id/activate, but runtime linkage is elsewhere."
      - path: "apps/api/src/routes/livekit.ts"
        issue: "Session start resolves providers from starter_agent_settings (device-based), not active agent_profiles."
      - path: "apps/voice-agent"
        issue: "No consumer of agent_profiles profile payload found."
    missing:
      - "Wire live session provider resolution to active profile (or selected profile id) from agent_profiles."
      - "Pass resolved profile configuration to voice-agent dispatch and apply it at runtime."
  - truth: "User can test connectivity for each provider (LLM, TTS, STT, N8N) from the dashboard and see success/failure feedback, including hearing TTS audio playback and seeing STT transcription results"
    status: partial
    reason: "TTS/STT/N8N test flows are implemented, but no LLM connection test action is present in Model tab or connection hook."
    artifacts:
      - path: "apps/voice-dashboard/src/components/tabs/model-tab.tsx"
        issue: "Model tab has config fields only; no test action."
      - path: "apps/voice-dashboard/src/lib/hooks/use-connection-test.ts"
        issue: "No LLM test method or endpoint wiring."
    missing:
      - "Add LLM connectivity test endpoint usage and a Model-tab test action with success/failure feedback."
      - "Include request composition using model-tab OpenAI-compatible config (base URL, endpoint, headers, body overrides)."
---

# Phase 02: profile-management Verification Report

**Phase Goal:** Users can create, configure, and activate voice agent profiles through a complete dashboard UI, replacing the old VoiceAgentSettingsPage entirely.  
**Verified:** 2026-03-22T16:26:16Z  
**Status:** gaps_found  
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | User can create a named profile, see it in sidebar, and open 4-tab editor | ✓ VERIFIED | `useProfiles/useCreateProfile` API hooks exist ([apps/voice-dashboard/src/lib/hooks/use-profiles.ts](apps/voice-dashboard/src/lib/hooks/use-profiles.ts)); sidebar create + navigation implemented ([apps/voice-dashboard/src/components/profile-sidebar.tsx](apps/voice-dashboard/src/components/profile-sidebar.tsx)); editor has 4 tabs Model/Voice/Transcriber/Tools ([apps/voice-dashboard/src/components/profile-editor.tsx](apps/voice-dashboard/src/components/profile-editor.tsx)). |
| 2 | User can fill all tab config fields, save, and values persist on reload | ✓ VERIFIED | All required fields are present across tabs ([apps/voice-dashboard/src/components/tabs/model-tab.tsx](apps/voice-dashboard/src/components/tabs/model-tab.tsx), [voice-tab.tsx](apps/voice-dashboard/src/components/tabs/voice-tab.tsx), [transcriber-tab.tsx](apps/voice-dashboard/src/components/tabs/transcriber-tab.tsx), [tools-tab.tsx](apps/voice-dashboard/src/components/tabs/tools-tab.tsx)); submit updates API via `useUpdateProfile` and reload path fetches + `form.reset` from API data ([apps/voice-dashboard/src/components/profile-editor.tsx](apps/voice-dashboard/src/components/profile-editor.tsx)). |
| 3 | User can activate a profile, see indicator, and next voice call uses that profile config | ✗ FAILED | Activation and badge are implemented ([apps/voice-dashboard/src/components/profile-sidebar.tsx](apps/voice-dashboard/src/components/profile-sidebar.tsx), [apps/api/src/routes/admin-agent-profiles.ts](apps/api/src/routes/admin-agent-profiles.ts)); but call runtime still resolves from `starter_agent_settings` in session start ([apps/api/src/routes/livekit.ts](apps/api/src/routes/livekit.ts)), with no `agent_profiles` consumption in runtime path. |
| 4 | User can clone, delete non-active with confirm, and import config by cURL | ✓ VERIFIED | Clone/delete (with confirmation dialog) implemented in sidebar ([apps/voice-dashboard/src/components/profile-sidebar.tsx](apps/voice-dashboard/src/components/profile-sidebar.tsx)); backend delete guard (409 on active profile) and duplicate endpoint implemented ([apps/api/src/routes/admin-agent-profiles.ts](apps/api/src/routes/admin-agent-profiles.ts)); cURL import parser + dialog + form mapping wired ([apps/voice-dashboard/src/lib/utils/curl-parser.ts](apps/voice-dashboard/src/lib/utils/curl-parser.ts), [apps/voice-dashboard/src/components/forms/curl-import-dialog.tsx](apps/voice-dashboard/src/components/forms/curl-import-dialog.tsx), [apps/voice-dashboard/src/components/tabs/tools-tab.tsx](apps/voice-dashboard/src/components/tabs/tools-tab.tsx)). |
| 5 | User can test LLM/TTS/STT/N8N connectivity with proper feedback (incl. TTS audio + STT transcript) | ✗ FAILED | TTS/STT/N8N tests are wired ([apps/voice-dashboard/src/lib/hooks/use-connection-test.ts](apps/voice-dashboard/src/lib/hooks/use-connection-test.ts), tab components); but no LLM test path/action exists in model tab or test hook. |

**Score:** 3/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/api/src/routes/admin-agent-profiles.ts` | CRUD + activate + duplicate API | ✓ VERIFIED | Exists, substantive (259 lines), wired from app router. |
| `apps/api/src/routes/__tests__/agent-profiles.test.ts` | Profile CRUD integration coverage | ✓ VERIFIED | Exists, substantive (231 lines), covers create/list/update/activate/delete guard/duplicate. |
| `apps/voice-dashboard/src/components/profile-sidebar.tsx` | Sidebar list + profile actions | ✓ VERIFIED | Exists, substantive (269 lines), imported by dashboard layout. |
| `apps/voice-dashboard/src/lib/hooks/use-profiles.ts` | Profile query/mutation hooks | ✓ VERIFIED | Exists, substantive (115 lines), used by sidebar/editor pages. |
| `apps/voice-dashboard/src/lib/schemas/profile.ts` | Form schema/type | ✓ VERIFIED | Exists (39 lines); compact but substantive schema with required sections. |
| `apps/voice-dashboard/src/providers/query-provider.tsx` | TanStack Query provider | ✓ VERIFIED | Exists (21 lines), imported in dashboard layout and wraps children. |
| `apps/voice-dashboard/src/components/profile-editor.tsx` | Editor submit + tab container | ✓ VERIFIED | Exists (205 lines), imports and renders all tab components, handles save. |
| `apps/voice-dashboard/src/components/tabs/model-tab.tsx` | LLM fields + prompt/greeting/speaks_first | ⚠️ PARTIAL | Config UI exists, but no LLM connection-test action. |
| `apps/voice-dashboard/src/components/tabs/voice-tab.tsx` | TTS config + playback test | ✓ VERIFIED | Test button + audio blob playback present. |
| `apps/voice-dashboard/src/components/tabs/transcriber-tab.tsx` | STT config + mic transcription test | ✓ VERIFIED | Mic recording + transcribe flow and transcript rendering present. |
| `apps/voice-dashboard/src/components/tabs/tools-tab.tsx` | N8N config/test + cURL import | ✓ VERIFIED | N8N test action and cURL import wiring present. |
| `apps/api/src/routes/livekit.ts` | Active profile runtime consumption for sessions | ✗ MISSING/WIRING GAP | Session uses `getStarterAgentSettingsWithDefault` and resolved starter providers; not connected to `agent_profiles`. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `apps/api/src/app.ts` | `apps/api/src/routes/admin-agent-profiles.ts` | `app.use("/v1/admin/agent-profiles", requireAuth("admin"), agentProfilesRouter)` | WIRED | Found in `app.ts:363`. |
| `apps/voice-dashboard/src/components/profile-sidebar.tsx` | `/v1/admin/agent-profiles` | `useProfiles()/mutations -> request()` | WIRED | `useProfiles` and mutations call `/v1/admin/agent-profiles*`. |
| `apps/voice-dashboard/src/app/(dashboard)/layout.tsx` | `ProfileSidebar` | import + render | WIRED | `layout.tsx` imports and renders `<ProfileSidebar />`. |
| `apps/voice-dashboard/src/app/(dashboard)/layout.tsx` | `QueryProvider` | provider wraps dashboard | WIRED | `layout.tsx` wraps children in `<QueryProvider>`. |
| `apps/voice-dashboard/src/components/profile-editor.tsx` | tab components | imports + `<TabsContent>` render | WIRED | Model/Voice/Transcriber/Tools all rendered. |
| `apps/voice-dashboard/src/components/tabs/voice-tab.tsx` | `/v1/admin/livekit/test/tts` | `useConnectionTest().testTts` | WIRED | Endpoint exists in hook and is invoked from tab. |
| `apps/voice-dashboard/src/components/tabs/transcriber-tab.tsx` | `/v1/admin/livekit/test/stt` + `/test/stt/transcribe` | `useConnectionTest()` | WIRED | Both endpoints called from transcriber flow. |
| `apps/voice-dashboard/src/components/tabs/tools-tab.tsx` | `/v1/admin/livekit/test/n8n` | `useConnectionTest().testN8n` | WIRED | Endpoint exists and tab calls test action. |
| Active profile state (`agent_profiles.is_active`) | Live session provider selection | session-start runtime wiring | NOT_WIRED | No read/use of `agent_profiles` in call runtime route; starter settings path is used instead. |
| `apps/voice-dashboard/src/components/tabs/model-tab.tsx` | LLM test endpoint | connection-test action | NOT_WIRED | No LLM test function/component usage. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| PROF-01 | 02-01, 02-02 | Create named profile | ✓ SATISFIED | POST create API + create dialog wired. |
| PROF-02 | 02-01, 02-02 | View all profiles in sidebar | ✓ SATISFIED | GET list API + sidebar render. |
| PROF-03 | 02-01, 02-02 | Delete profile (not active) with confirmation | ✓ SATISFIED | Backend 409 guard + sidebar confirmation dialog. |
| PROF-04 | 02-01, 02-02 | Clone profile | ✓ SATISFIED | Duplicate API + clone action in sidebar. |
| PROF-05 | 02-01, 02-02 | Mark one active profile exclusively | ✓ SATISFIED | Transactional activate route and active badge updates in UI. |
| PROF-06 | 02-02 | Active profile visually indicated | ✓ SATISFIED | `Badge` shows Active/Inactive in sidebar cards. |
| MODEL-01 | 02-01, 02-03 | LLM base URL/API key/model config | ✓ SATISFIED | Model tab fields + persisted via profile update. |
| MODEL-02 | 02-01, 02-03 | LLM custom headers | ✓ SATISFIED | `llm_config.custom_headers` via `KeyValueEditor`. |
| MODEL-03 | 02-01, 02-03 | LLM custom body params | ✓ SATISFIED | `llm_config.custom_body_params` via `KeyValueEditor`. |
| MODEL-04 | 02-01, 02-03 | LLM endpoint path override | ✓ SATISFIED | `llm_config.endpoint_path` field exists and persists. |
| MODEL-05 | 02-01, 02-03 | System prompt edit/save | ✓ SATISFIED | `system_prompt` field bound and submitted. |
| MODEL-06 | 02-01, 02-03 | Speaks-first behavior config | ✓ SATISFIED | `speaks_first` switch exists and persists. |
| MODEL-07 | 02-01, 02-03 | Greeting enable/instruction config | ✓ SATISFIED | Greeting switch + instruction field bound. |
| VOICE-01 | 02-01, 02-03 | TTS base URL/API key | ✓ SATISFIED | `tts_config.base_url/api_key` fields present. |
| VOICE-02 | 02-01, 02-03 | TTS endpoint path override | ✓ SATISFIED | `tts_config.endpoint_path` field present. |
| VOICE-03 | 02-01, 02-03 | Voice ID config | ✓ SATISFIED | `tts_config.voice_id` field present. |
| VOICE-04 | 02-01, 02-03 | TTS custom body params | ✓ SATISFIED | `tts_config.custom_body_params` editor present. |
| VOICE-05 | 02-01, 02-03 | TTS custom headers | ✓ SATISFIED | `tts_config.custom_headers` editor present. |
| VOICE-06 | 02-03 | Test TTS with browser playback | ? NEEDS HUMAN | UI/hook/audio element exists; browser playback must be manually validated end-to-end. |
| STT-01 | 02-01, 02-03 | STT base URL/API key | ✓ SATISFIED | `stt_config.base_url/api_key` fields present. |
| STT-02 | 02-01, 02-03 | STT endpoint path override | ✓ SATISFIED | `stt_config.endpoint_path` field present. |
| STT-03 | 02-01, 02-03 | STT model and language | ✓ SATISFIED | `stt_config.model/language` fields present. |
| STT-04 | 02-01, 02-03 | STT custom headers | ✓ SATISFIED | `stt_config.custom_headers` editor present. |
| STT-05 | 02-01, 02-03 | STT custom body/query params | ✓ SATISFIED | Both `custom_body_params` and `custom_query_params` editors present. |
| STT-06 | 02-03 | Test STT from mic and show transcript | ? NEEDS HUMAN | MediaRecorder + transcript rendering exists; mic/browser permissions/runtime transcription need manual test. |
| TOOLS-01 | 02-01, 02-03 | N8N base URL config | ✓ SATISFIED | `n8n_config.base_url` field present. |
| TOOLS-02 | 02-01, 02-03 | N8N webhook path config | ✓ SATISFIED | `n8n_config.webhook_path` field present. |
| TOOLS-03 | 02-01, 02-03 | N8N MCP webhook path config | ✓ SATISFIED | `n8n_config.mcp_webhook_path` field present. |
| TOOLS-04 | 02-03 | N8N connectivity test | ✓ SATISFIED | `/v1/admin/livekit/test/n8n` wiring exists with status feedback. |
| TOOLS-05 | 02-03 | Import config from cURL | ✓ SATISFIED | cURL dialog + parser + setValue mapping implemented. |

Orphaned requirements for Phase 2 (in REQUIREMENTS.md but absent from plan `requirements`): **None found**.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | - | TODO/FIXME/placeholder/empty-stub scan on phase commits | ℹ️ Info | No blocker/warning anti-patterns detected in scanned files. |

### Human Verification Required

### 1. TTS Playback
**Test:** In Voice tab, run Test TTS with valid provider credentials.  
**Expected:** Success badge and audible playback in browser audio element.  
**Why human:** Actual audio decode/playback and browser autoplay behavior cannot be proven by static code checks.

### 2. STT Mic Transcription
**Test:** In Transcriber tab, allow mic access, record, stop, and inspect transcript result.  
**Expected:** Transcript text appears; failure path shows clear error if provider fails.  
**Why human:** Depends on browser permission flow, MediaRecorder runtime behavior, and external STT response.

### 3. N8N Live Reachability
**Test:** Run N8N test against a real reachable webhook base/path.  
**Expected:** Success/failure reflects true network/server state.  
**Why human:** External network and webhook environment are runtime-dependent.

### Gaps Summary

Phase 02 delivers most CRUD/UI/configuration requirements, but the phase goal is not fully achieved because two goal-critical links are incomplete:

1. Active profile selection is not wired into live call runtime; session startup still uses legacy `starter_agent_settings`.
2. Provider test coverage in dashboard lacks LLM test action, while roadmap success criteria require connectivity testing across LLM/TTS/STT/N8N.

Additionally, the old admin `VoiceAgentSettingsPage` is still present and routed in `apps/admin/src/AppShell.tsx`, so "replace entirely" is not yet demonstrably complete.

---

_Verified: 2026-03-22T16:26:16Z_  
_Verifier: Claude (gsd-verifier)_
