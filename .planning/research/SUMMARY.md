# Project Research Summary

**Project:** Coziyoo v2 — Voice-First Food Ordering Marketplace
**Domain:** Brownfield mobile platform with AI voice ordering integration (Expo + LiveKit Python Agents + n8n)
**Researched:** 2026-03-12
**Confidence:** HIGH (all four research areas grounded in direct codebase inspection)

## Executive Summary

Coziyoo v2 is a brownfield project where the core platform (Express API, Expo mobile app, admin panel, PostgreSQL) is complete and working. The primary integration challenge is a voice ordering pipeline connecting four systems across three process boundaries: Expo mobile → Node API → Python LiveKit voice agent → n8n workflow engine. All four research areas confirm that the code architecture is fundamentally sound — the patterns chosen (two-hop session end, n8n as synchronous LLM, explicit agent dispatch, data channel UI actions) are correct and match industry best practice. The problems are at the integration seams: misconfigured or missing environment variables, a process split between the Python join API and worker that is easy to misconfigure, and silent failure modes that make debugging extremely difficult without the log viewer — which is itself broken.

The recommended approach is to fix the integration seams in strict dependency order: session startup first, then observability (log viewer), then the session-end webhook chain, then n8n order creation, and only then add the new UX features (order confirmation, post-session screen). This order is non-negotiable because each seam depends on the one before it — you cannot debug the session-end chain without a working session, and you cannot debug either without a working log viewer. The primary risks are all operational, not architectural: silent exception handling in the Python agent swallows critical failures; the shared secret between API and voice agent is marked optional in the env schema despite being mandatory for function; n8n webhook URL construction has three competing resolution paths that can diverge without error.

Every identified risk can be mitigated with startup validation, improved logging severity, and a diagnostics endpoint that tests the full integration chain on boot. The product code is further along than it appears — most table-stakes UX already exists in the codebase (audio session gating, agent timeout, disconnect alerts, data channel action banners). The gap is reliability and observability, not features.

---

## Key Findings

### Recommended Stack

The stack is locked by brownfield constraint. Research focus was on integration seam health and version compatibility. The core finding is that `livekit-agents` should be upgraded from `>=1.2.6` to `>=1.4.5` (released 2026-03-11) because version 1.4.2 fixed multiple memory leaks in the process pool. The mobile `livekit-client` at `^2.9.4` is currently safe but upgrading to `2.17.2` is recommended — the range 2.15.9–2.15.11 has a confirmed stuck-connecting bug on React Native and must be skipped. A critical compatibility risk is React Native New Architecture (bridgeless mode), enabled by default in React Native 0.76 (Expo 52), which has active reported incompatibilities with LiveKit (issue #305). This must be validated on physical device during Phase 1.

**Core technologies:**
- `livekit-agents>=1.4.5` (Python): Voice pipeline worker — upgrade recommended; 1.4.2 fixed memory leaks in process pool
- `livekit-server-sdk@2.15.0` (Node.js): Token minting and room management — current, no change needed
- `@livekit/react-native@2.9.6`: WebRTC mobile client — current; do NOT upgrade into 2.15.9–2.15.11 range (stuck-connecting bug)
- `livekit-client@2.17.2` (mobile): Recommended upgrade target for livekit-client
- `n8n` (self-hosted): LLM orchestration and order workflow brain — keep as-is
- `FastAPI>=0.115.0`: Python join API and log viewer — current, no change needed
- `livekit-plugins-turn-detector>=1.4.5`: Multilingual turn detection (~400MB RAM, 14 languages including Turkish)

**Critical version constraint:** `LIVEKIT_ENABLE_NOISE_CANCELLATION` must remain `false` on self-hosted LiveKit — the BVC noise filter is LiveKit Cloud-only and causes errors when enabled on self-hosted.

**Critical process constraint:** The Python join API (`uvicorn voice_agent.join_api:app`) and the Python worker (`python -m voice_agent.entrypoint`) are two separate processes. Both must be running for sessions to work. The join API alone responding on port 9000 does not mean the agent will join rooms.

### Expected Features

The codebase has more built than is currently working. The session start screen, audio session gating, data channel action banners, agent timeout, disconnect alerts, and the log viewer are all coded. The broken features are the integration seams: session startup reliability, the session-end webhook chain, and n8n order creation.

**Must have (table stakes — broken or unverified):**
- Reliable session start (mobile tap → agent joins room every time) — currently unreliable end-to-end
- Working end-of-call webhook (agent → API → n8n) — currently not firing correctly
- n8n creates order in PostgreSQL after session ends — currently not working
- Order confirmation before placement — not yet built as a structured UX gate
- Post-session feedback screen — coded as navigate-back only; no order summary shown
- Log viewer at `:9000/logs/viewer` — built but unhealthy; needed as launch debugging gate

**Should have (competitive, add after core loop is verified):**
- Data channel action banners confirmed working on real `add_to_cart` events
- Structured session outcome sent to n8n (`order_placed` / `no_order` / `error` vs. always "completed")
- Seller notification via n8n after order creation
- User memory persisted across sessions and injected at session start

**Defer (v2+):**
- Cook-side voice ordering — explicitly deferred in project constraints
- Locale/language selection in-app UI — groundwork exists; surface when multilingual support is needed
- Reconnect on unexpected disconnect — current "End Session" alert is adequate for v1
- Voice-initiated payment processing — high-stakes; requires separate secure confirmation UX

### Architecture Approach

The architecture is a five-component system with three process boundaries. The design is correct and must not be changed. The voice agent intentionally routes through the API to reach n8n (not directly) so that per-device n8n URL overrides from the admin settings database can be applied server-side. The n8n per-turn LLM call is synchronous (webhook primary, execution API polling fallback) — this is architecturally correct, but the fallback adds 600ms minimum latency per turn, so the primary webhook path must be kept working. The data channel for UI actions correctly keeps UI state in mobile, not in the voice agent.

**Major components:**
1. **Expo mobile** — session initiation, WebRTC audio, data channel action rendering, state feedback
2. **Node API (livekit.ts)** — orchestrates session startup atomically; mediates all agent↔n8n communication; applies per-device settings
3. **Python join API (port 9000, separate process)** — validates and dispatches agent; serves the log viewer
4. **Python voice agent worker (separate process)** — runs VAD→STT→N8nLLM→TTS pipeline per job; fires session-end webhook
5. **n8n** — LLM brain per conversation turn; order creation workflow on session end; optional user memory storage

**Key data flows:**
- Session start: Mobile → API (atomic: room, tokens, dispatch, preflight) → join API → LiveKit dispatch queue → worker
- Per-turn: Worker → n8n webhook (synchronous) → response text → TTS → audio to room
- Session end: Worker → API (shared secret) → n8n session-end webhook (3-retry) → n8n order creation → PostgreSQL

### Critical Pitfalls

1. **AI_SERVER_SHARED_SECRET is optional in the env schema but mandatory for function** — if missing or mismatched, session-end webhook returns 503/401 silently; `_notify_session_end()` logs a warning and drops the event; no order is ever created. Fix: make it required in startup validation on both services; log at ERROR not WARNING on 4xx/5xx.

2. **n8n webhook URL has three competing resolution paths that can silently diverge** — `N8N_HOST` env (API side), `_resolve_n8n_webhook()` in Python (6 resolution branches), and per-device database override. Any divergence routes LLM calls to one n8n workflow and session-end events to another, or to an unreachable URL with no error surfaced. Fix: add a startup diagnostics endpoint that logs resolved URLs for all n8n call paths.

3. **Agent worker not running while join API responds = misleading health signal** — FastAPI on port 9000 can return 200 on `/health` while the LiveKit Agents worker is not running. Sessions hang at "Waiting for agent..." for 30 seconds. Fix: health check must verify both processes, not just the HTTP port.

4. **Log viewer shows "No logs." identically whether file is missing or sessions haven't happened** — the log file is only created when the worker starts. If only the join API is running, the viewer is empty and indistinguishable from genuine no-data. Fix: distinguish "file not found" vs "file empty" in the `/logs/requests` API response.

5. **n8n session-end workflow must be activated, not just saved** — n8n webhooks return 404 when workflow is in draft/inactive state. A workflow tested in the n8n editor (test mode) silently stops responding when the editor is closed. Fix: add a health check that calls the session-end webhook path and verifies 2xx; document the activation requirement explicitly.

---

## Implications for Roadmap

The dependency chain is linear and strict: session startup must work before the session-end chain can be tested; the log viewer must work before the n8n chain can be debugged efficiently; the full happy path must work before UX features can be meaningfully added. Build in that order.

### Phase 1: Voice Session Startup Reliability

**Rationale:** Everything downstream depends on a session reliably starting. This is the entry gate — without it, no other phase can be tested on real hardware. Physical device testing on iOS and Android is mandatory here; simulators mask audio session issues.
**Delivers:** User taps Start → agent joins → conversation begins consistently on physical iOS and Android devices.
**Addresses:** Reliable session start (P1); iOS audio session race condition; agent dispatch stability; metadata JSON validation at API boundary.
**Avoids:**
- Pitfall 3 (agent never joins — worker not running)
- Pitfall 6 (iOS AudioSession race condition causing silent mic failure)
- Pitfall 7 (unvalidated metadata JSON crashing agent on startup)
- React Native New Architecture incompatibility with LiveKit (disable `"newArchEnabled"` if connection failures occur)
**Research flag:** Standard patterns — LiveKit dispatch is well-documented; code is already correctly structured. No additional research phase needed.

### Phase 2: Observability — Log Viewer Fix

**Rationale:** Before fixing the end-of-call chain, engineers need visibility into what is happening inside the pipeline. Fixing the log viewer first turns Phase 3 debugging from hours to minutes. This is a force multiplier on all subsequent phases.
**Delivers:** `:9000/logs/viewer` shows every STT transcript, n8n request/response, and TTS output for every session; sessions grouped correctly by room/job; "file not found" distinguished from "no sessions."
**Addresses:** Log viewer working (P1 launch gate per FEATURES.md).
**Avoids:**
- Pitfall 4 (log file missing = empty viewer = blind debugging)
- Anti-Pattern: missing `room_id`/`job_id` in log extra fields causing entries to appear under phantom "unknown" session
**Research flag:** Standard patterns — known root causes; no additional research needed.

### Phase 3: End-of-Call Webhook Chain

**Rationale:** With session startup and observability working, the session-end path can be fixed and verified using the log viewer. This is the second major broken seam and the prerequisite for order creation.
**Delivers:** Agent session end reliably fires `POST /livekit/session/end` on the API; API reliably forwards to n8n with 3-retry backoff; n8n session-end webhook receives the event.
**Addresses:** End-of-call webhook fix (P1).
**Avoids:**
- Pitfall 1 (AI_SERVER_SHARED_SECRET misconfiguration)
- Pitfall 2 (n8n webhook URL divergence)
- Pitfall 5 (n8n workflow inactive)
**Research flag:** No additional research needed — code path is fully mapped in ARCHITECTURE.md.

### Phase 4: n8n Order Creation End-to-End

**Rationale:** Once session-end events reliably reach n8n, the order creation workflow can be wired and verified. This is the final broken seam and the core product value — voice ordering has zero value if orders don't land in the database.
**Delivers:** After a voice session ends, an order record appears in PostgreSQL; n8n triggers seller notification.
**Addresses:** n8n order creation (P1); seller notification (P2 as downstream of this fix).
**Avoids:**
- Anti-pattern of calling n8n directly from voice agent instead of via API
- n8n workflow in inactive state (must be verified as "Active" in n8n UI)
**Research flag:** Needs n8n workflow inspection — the n8n workflow configuration is external to the codebase; verify the order creation logic, auth mechanism (service account token vs. buyer JWT), and whether the `coziyoo/session-end` trigger path is configured correctly. This phase may need a lightweight research step before planning.

### Phase 5: Order Confirmation UX and Post-Session Screen

**Rationale:** With the full ordering pipeline verified end-to-end, add the UX layer that makes voice ordering trustworthy. STT makes mistakes; food quantity and allergen errors are costly; order confirmation before placement is non-negotiable.
**Delivers:** Agent reads back order summary via `show_order_summary` data channel action and waits for verbal confirmation before sending to n8n. Post-session screen shows order ID or "no order placed."
**Addresses:** Order confirmation before placement (P1); post-session feedback screen (P1).
**Avoids:**
- Anti-feature: fully automated order placement without confirmation (documented failure pattern from Taco Bell 2025 drive-through AI)
- Anti-feature: displaying chat transcript during live voice session (splits attention)
- Anti-feature: voice-initiated payment processing
**Research flag:** Needs design coordination — the confirmation gate requires a defined conversation turn in the n8n LLM workflow (not just voice agent code). Coordinate with n8n workflow author during phase planning; no external research needed.

### Phase 6: Reliability Polish and Data Channel Verification

**Rationale:** Once the happy path is working end-to-end, harden the failure modes and add the P2 features that complete the product experience.
**Delivers:** Data channel `add_to_cart` banners confirmed working on real events; structured session outcomes (`order_placed`/`no_order`/`error`) sent to n8n; `sendSessionEndEvent()` gets per-request timeout via `AbortController`; agent-not-available timeout reduced from 30s to 10-15s with progress indicator at 5s.
**Addresses:** Data channel banners verified (P2); structured session outcome (P2); UX pitfalls (timeout reduction, "Preparing audio..." state on iOS).
**Avoids:**
- Performance trap: `sendSessionEndEvent()` has no per-request timeout — add `AbortController` with 8s per attempt
- Performance trap: `asyncio.sleep(0.6)` fixed delay in n8n execution API fallback — replace with poll loop
- UX pitfall: 30-second hang before "Agent Not Available" (users assume broken app)
**Research flag:** Standard patterns — incremental improvements on verified working code; no research needed.

### Phase 7: User Memory and Cross-Session Personalization

**Rationale:** Deferred until the core ordering loop is validated in production. User memory adds significant complexity (persistence schema, n8n memory read/write, metadata size constraints) and is valuable only after the product demonstrably works.
**Delivers:** Agent remembers user preferences and past orders; session start injects memory as metadata; session end persists new facts to database or n8n.
**Addresses:** User memory across sessions (P3).
**Avoids:**
- Memory conflicts with stateless design: memory injected at session start must be persisted at session end — requires explicit DB schema or n8n storage mechanism
- Metadata overflow: agent metadata is capped at 2000 chars in the LiveKit token; large memory objects will be silently truncated
**Research flag:** Needs research before planning — the memory persistence schema is undefined. Key questions: Where does memory live (PostgreSQL table vs. n8n credential store)? What is the max useful size? How is it fetched at session start without adding latency? Plan a lightweight research step before this phase.

### Phase Ordering Rationale

- **Sessions before webhooks:** You cannot test the session-end path without a working session.
- **Observability before debugging:** Fix the log viewer before attempting to debug the n8n chain — otherwise every failure requires SSH log inspection and hours of blind iteration.
- **Core ordering loop before UX:** Post-session screen and order confirmation require a working n8n order creation path to show meaningful data; building them before is wasted effort.
- **P1 features before P2:** Every P2 feature (data channel verification, seller notification, structured outcomes) is downstream of the P1 reliability fixes.
- **User memory last:** It is the only feature requiring a new DB schema and n8n workflow changes; defer until product-market fit is established.

### Research Flags

Phases likely needing a deeper research step during planning:
- **Phase 4 (n8n Order Creation):** n8n workflow configuration is external to the codebase; the order creation workflow, auth mechanism, and webhook path configuration need hands-on inspection before implementation work begins.
- **Phase 7 (User Memory):** No schema exists for memory persistence; need to define storage location, size constraints, and session-start injection mechanism before planning the phase.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Session Startup):** LiveKit dispatch is well-documented; code is already correctly structured.
- **Phase 2 (Log Viewer):** Logging fix with known root causes from codebase inspection.
- **Phase 3 (Session-End Webhook):** All code paths fully mapped from direct source reading.
- **Phase 5 (Order Confirmation):** Requires design coordination with n8n workflow, not external research.
- **Phase 6 (Reliability Polish):** Incremental improvements on known patterns.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All version recommendations verified against PyPI, npm registry, and official LiveKit docs; version-specific bugs corroborated by GitHub issue reports with fix commits |
| Features | HIGH | Primary evidence is direct codebase inspection of what is coded vs. what is reported broken; web research confirms voice UI confirmation UX best practices |
| Architecture | HIGH | Entire architecture documented from direct source code reading; component boundaries, data flows, and failure modes verified line-by-line |
| Pitfalls | HIGH | Every pitfall traced to specific file and line in codebase (env.ts optional schema, _notify_session_end exception handler, n8n URL resolution branches); no speculative risks included |

**Overall confidence:** HIGH

### Gaps to Address

- **n8n workflow configuration (Phase 4):** The n8n session-end and LLM workflows are external to the codebase and were not inspected. Whether the order creation workflow exists, what auth it uses to call the API, and whether the `coziyoo/session-end` trigger path is correctly configured is unknown. Must be verified during Phase 4 planning.
- **iOS physical device behavior (Phase 1):** Research confirms the correct AudioSession code pattern is already in place, but actual behavior on physical iOS hardware (permission flow, AVAudioSession conflicts, iOS 18+ behavior) was not validated by test. Required during Phase 1.
- **React Native New Architecture + LiveKit (Phase 1):** Expo 52 enables New Architecture by default on React Native 0.76; livekit/client-sdk-react-native issue #305 is an active open issue. Must be tested on device and `"newArchEnabled": false` applied as mitigation if connection failures occur.
- **User memory schema (Phase 7):** No research done on memory persistence shape or storage location. This gap is acceptable — the feature is deferred to Phase 7.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `apps/voice-agent/src/voice_agent/entrypoint.py` — session-end flow, n8n URL resolution, disconnect handling
- Direct codebase inspection: `apps/voice-agent/src/voice_agent/join_api.py` — log viewer, worker dispatch, auth model
- Direct codebase inspection: `apps/api/src/routes/livekit.ts` — session startup orchestration, shared secret validation
- Direct codebase inspection: `apps/api/src/services/n8n.ts` — session-end retry logic, webhook URL construction
- Direct codebase inspection: `apps/mobile/src/screens/VoiceSessionScreen.tsx` — audio session gating, agent timeout, disconnect handling
- Direct codebase inspection: `apps/mobile/src/screens/HomeScreen.tsx` — session start flow, agent dispatch guard, n8n preflight
- Direct codebase inspection: `apps/api/src/config/env.ts` — optional vs. required env vars
- [livekit-agents PyPI](https://pypi.org/project/livekit-agents/) — version 1.4.5 confirmed latest, Python 3.10+ requirement
- [LiveKit Agents GitHub releases](https://github.com/livekit/agents/releases) — 1.4.2 memory leak fix confirmed
- [LiveKit Agents dispatch docs](https://docs.livekit.io/agents/server/agent-dispatch/) — explicit vs. auto dispatch
- [LiveKit Agent session docs](https://docs.livekit.io/agents/logic/sessions/) — session.start() non-blocking behavior
- [livekit-plugins-turn-detector PyPI](https://pypi.org/project/livekit-plugins-turn-detector/) — 1.4.5 latest, 14 languages
- [LiveKit Expo quickstart](https://docs.livekit.io/transport/sdk-platforms/expo/) — installation and plugin config

### Secondary (MEDIUM confidence)
- [livekit/client-sdk-react-native issue #304](https://github.com/livekit/client-sdk-react-native/issues/304) — stuck-connecting bug in 2.15.9–2.15.11
- [livekit/client-sdk-react-native issue #305](https://github.com/livekit/client-sdk-react-native/issues/305) — New Architecture incompatibility (active issue)
- [livekit/client-sdk-react-native issue #286](https://github.com/livekit/client-sdk-react-native/issues/286) — expo-audio conflict with LiveKit on iOS
- [livekit/agents issue #1581](https://github.com/livekit/agents/issues/1581) — on("disconnected") unreliable on unexpected exit
- n8n community + official docs — 60s webhook timeout, "Respond to Webhook" node pattern
- [Voice Commerce and Confirmation UX — Cloudflight](https://www.cloudflight.io/en/blog/what-is-voice-commerce-and-how-its-transforming-ecommerce-in-2025/) — confirmation gate best practice
- [Building Production-Ready Voice Agents — Shekhar Gulati (2026)](https://shekhargulati.com/2026/01/03/building-production-ready-voice-agents/) — observability patterns

### Tertiary (LOW confidence)
- Taco Bell 2025 drive-through AI failure pattern — cited in FEATURES.md as evidence for confirmation gate necessity; exact incident details not independently verified

---
*Research completed: 2026-03-12*
*Ready for roadmap: yes*
