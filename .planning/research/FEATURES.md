# Feature Research

**Domain:** Voice-first food ordering marketplace (mobile, AI-mediated, brownfield)
**Researched:** 2026-03-12
**Confidence:** HIGH (primary evidence from codebase inspection + MEDIUM from web research)

---

## Context: What Already Exists

The following is already coded in the codebase and is therefore given, not aspirational:

- LiveKit room creation and token minting (API + mobile client)
- Voice session screen: connection states, agent speaking pulse, mic mute/unmute, end session confirm
- Agent timeout if no participant joins within 30 seconds (mobile)
- Unintentional disconnect detection with alert (mobile)
- Data channel action banners: `navigate`, `add_to_cart`, `show_order_summary` (mobile)
- Voice agent log viewer at `:9000/logs/viewer` — sessions grouped by room, turn-level STT/N8N/TTS traces
- n8n preflight check at session start with user-facing warning if unreachable (mobile)
- Agent dispatch failure block — session blocked if agent won't join (mobile)
- Session end webhook from voice agent to API, which forwards to n8n
- Rotating file log for all STT/LLM/TTS/N8N requests with JSON lines format
- N8N LLM path with webhook + execution API fallback

What the codebase reports as broken/unverified (from PROJECT.md):
- Voice session startup from mobile is unreliable end-to-end
- End-of-call webhook not firing correctly
- n8n → order creation flow not working
- Log viewer at :9000/logs/viewer not healthy for debugging

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Reliable session start (API + agent dispatch in one atomic flow) | User taps "Start" and expects something to happen — partial starts break trust | HIGH | Currently unreliable; the session start endpoint, LiveKit room creation, and agent dispatch must all succeed or roll back cleanly |
| Visual connection state feedback | Users need to know if they are connected, waiting, or disconnected — silence reads as broken | LOW | Already coded; needs to be verified working in all states (Connecting, Reconnecting, Disconnected) |
| Agent timeout with clear message | If the voice agent never joins, users must be told why and given an exit path | LOW | 30s timeout exists in mobile; needs matching API-side health signal |
| Unexpected disconnect alert and recovery path | Network drops happen on mobile; users must not be silently stranded | LOW | Alert exists; recovery path is "End Session" only — no reconnect offered yet |
| Mic mute / unmute during session | Privacy control users expect in any voice product | LOW | Already coded |
| Explicit session end confirmation | Destructive action (ends conversation, may discard order) requires confirmation | LOW | Already coded |
| Order confirmation before placement | Placing a food order is irreversible; voice must repeat back what it heard and get explicit "yes" before sending to n8n | MEDIUM | Not yet coded as a structured UX step — currently the agent may place orders conversationally without a defined confirmation gate |
| Post-session feedback screen | User needs to know the session ended and what happened to their order — blank screen reads as crashed | MEDIUM | Not coded; currently `onEnd` navigates back to HomeScreen with no summary |
| n8n order creation end-to-end reliability | Voice ordering has zero value if orders don't land in the database | HIGH | Core integration seam is broken per PROJECT.md |
| Seller notification after voice order | Cooks must know an order arrived — n8n handles this but it's gated on the above | MEDIUM | Downstream of n8n fix |

### Differentiators (Competitive Advantage)

Features that set the product apart from standard food apps that use tap-based ordering.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Turn-level observability log viewer for admins | Enables rapid debugging without SSH into server — see exact STT text, n8n answer, TTS output per turn in a browser | MEDIUM | Log viewer exists structurally at :9000/logs/viewer but is reported unhealthy; this is a concrete debugging superpower once fixed |
| n8n preflight check surfaced to user | Proactively tells user "AI brain is unreachable" before they start talking — saves frustration | LOW | Already coded in mobile; needs to be reliable (the check result must be trustworthy) |
| Data channel action banners during voice session | Shows the user what the agent is doing in real time ("Added: Chicken Biryani x2") — bridges voice and visual | LOW | Already coded; should be verified it fires on real add_to_cart events |
| User memory carried across sessions | Agent remembers preferences and past orders — feels personal, not generic | MEDIUM | Metadata field exists in agent; memory population from database is not verified |
| Locale / language selection | Users in multilingual markets can speak in their preferred language; the agent adjusts STT + TTS | LOW | voiceLanguage field exists in agent settings; end-to-end is unverified |
| Structured session outcome to n8n (not just "completed") | Richer end-of-call payload (outcome, sentiment, chat history) enables smarter n8n workflows for follow-up | MEDIUM | EndSessionSchema has outcome/sentiment/metadata fields; agent currently always sends outcome="completed" |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time order tracking via voice during session | Sounds impressive | Voice is a turn-based interface; querying order status mid-session creates long waits, breaks conversation flow, and duplicates the UI | Send a push notification or show a post-session summary screen after the call ends |
| Fully automated order placement without confirmation step | Reduces friction | STT makes mistakes; food quantity and allergen errors are costly and erode trust fast; Taco Bell's 2025 drive-through AI failures were caused by exactly this | Always require explicit confirmation before firing the n8n order creation webhook |
| Chat transcript displayed during live voice session | Transparency | Splits user attention between screen and listening; voice sessions should be audio-first | Display transcript only in the post-session summary screen or admin panel |
| Voice-initiated payment processing | One-step ordering | Payment is high-stakes; accidental purchase risk is very high; voice has no reliable authentication equivalent to biometrics/PIN entry | Voice builds the cart; a push notification or in-app screen handles payment confirmation with proper auth |
| Cook-side voice ordering in v1 | Symmetry with buyer flow | Cook flow is undefined per PROJECT.md; building it now before buyer flow works wastes effort | Explicitly defer to v2+ per project constraints |
| Always-on microphone / background listening | Faster invocation | iOS/Android background microphone restrictions make this unreliable; creates privacy concerns with users | Require explicit tap to start session; keep it opt-in |

---

## Feature Dependencies

```
[Reliable session start]
    └──requires──> [LiveKit room creation stable]
    └──requires──> [Agent dispatch stable]
    └──requires──> [n8n preflight check trustworthy]

[Order confirmation UX]
    └──requires──> [Voice session in Connected state]
    └──requires──> [Data channel action "show_order_summary" fires correctly]

[n8n order creation]
    └──requires──> [End-of-call webhook fires reliably from agent]
    └──requires──> [API /livekit/session/end endpoint processes correctly]
    └──requires──> [n8n workflow receives and creates order in DB]

[Seller notification]
    └──requires──> [n8n order creation working]

[Post-session summary screen]
    └──requires──> [n8n order creation returns order ID]
    └──enhances──> [Order confirmation UX]

[Turn-level log viewer (working)]
    └──requires──> [Rotating log file writing correctly]
    └──requires──> [:9000/logs/viewer endpoint healthy]

[User memory across sessions]
    └──requires──> [Session end saves outcome + chat context to DB]
    └──requires──> [Session start fetches and injects user memory as metadata]

[Data channel action banners]
    └──requires──> [Agent sends structured JSON on agent-action topic]
    └──enhances──> [Order confirmation UX]
```

### Dependency Notes

- **Order confirmation requires data channel**: The `show_order_summary` action is the existing mechanism for surfacing order details to the user mid-session. Confirmation UX must hook into this.
- **Post-session summary requires n8n order creation**: Without an order ID returned from n8n, the summary screen can only show "session ended" — not "your order #123 was placed."
- **Log viewer requires log file health**: The log viewer reads from a rotating file. If the voice agent never writes to the file (misconfigured path, wrong permissions), the viewer is empty regardless of UI correctness.
- **User memory conflicts with stateless design if not stored**: Memory injected at session start is great, but it must be persisted somewhere (DB or n8n) at session end. This is an architectural dependency that needs explicit implementation.

---

## MVP Definition

### Launch With (v1)

The minimum needed to validate that voice ordering works end-to-end, and that users can complete a food order by talking.

- [ ] **Reliable session start** — user taps Start, agent joins, conversation begins every time
- [ ] **Working n8n end-of-call webhook** — session end fires reliably; n8n receives it
- [ ] **n8n creates order in database** — order appears in admin panel after call
- [ ] **Order confirmation before placement** — agent reads back order summary and waits for verbal "yes" before firing creation
- [ ] **Post-session feedback screen** — user sees "Your order has been placed" or "No order was placed" after call ends
- [ ] **Turn-level log viewer working** — admin can see STT/N8N/TTS trace for any session at :9000/logs/viewer

### Add After Validation (v1.x)

Features to add once the core ordering loop works.

- [ ] **Data channel banners verified** — add_to_cart and show_order_summary banners confirmed firing correctly on real orders
- [ ] **Structured session outcome** — agent sends outcome="order_placed"/"no_order"/"error" to n8n end-of-call
- [ ] **Seller notification** — n8n sends push/SMS to cook after order creation (likely already in n8n workflow; verify)
- [ ] **User memory persistence** — session end saves facts/preferences; session start injects them

### Future Consideration (v2+)

Features to defer until buyer voice ordering is validated in production.

- [ ] **Cook-side voice ordering** — project explicitly defers this
- [ ] **Locale / language selection in-app** — groundwork exists; surface as UI preference when multiple languages are needed
- [ ] **Reconnect on unexpected disconnect** — current behavior is "End Session" alert; auto-reconnect adds significant complexity
- [ ] **Voice-initiated payment** — requires separate secure confirmation UX

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Reliable session start | HIGH | HIGH | P1 |
| n8n end-of-call webhook fix | HIGH | MEDIUM | P1 |
| n8n order creation in DB | HIGH | MEDIUM | P1 |
| Order confirmation before placement | HIGH | MEDIUM | P1 |
| Log viewer working | HIGH (for debugging) | LOW | P1 |
| Post-session feedback screen | HIGH | LOW | P1 |
| Data channel banners verified | MEDIUM | LOW | P2 |
| Structured session outcome | MEDIUM | LOW | P2 |
| Seller notification (n8n) | HIGH | LOW (n8n workflow) | P2 |
| User memory across sessions | MEDIUM | HIGH | P3 |
| Locale / language selection | MEDIUM | LOW | P3 |
| Reconnect on unexpected disconnect | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — voice ordering does not work without these
- P2: Should have, adds reliability/value once core loop is working
- P3: Nice to have, deferred until product-market fit established

---

## Observability Feature Detail

Observability deserves its own section because it is both a developer tool and a launch gate for production debugging.

### What "observability" means for this system

The voice pipeline has five failure points per user turn: VAD (is the user speaking?), STT (did it transcribe correctly?), LLM/N8N (did the AI respond?), TTS (did it synthesize correctly?), data channel (did the UI action arrive?). Without turn-level visibility, any of these silently failing means hours of blind debugging.

### What exists

- Rotating JSON-lines log file at `.runtime/voice-agent-requests.log`
- Log entries for STT requests/responses, N8N requests/responses/errors, TTS requests/responses
- Log viewer at `:9000/logs/viewer` groups entries by room_id + job_id into sessions and turns
- Auto-refresh every 3 seconds, filterable by kind (stt/n8n/tts/llm) and free-text search

### What is broken / missing (per PROJECT.md)

- The log viewer endpoint itself is reported unhealthy — likely the FastAPI uvicorn process is not running, or the log file path is wrong in the environment
- No API-side session log — the Express API logs per-request (requestId) but there is no session-level record in the database that links a roomName to its outcome
- Admin panel has no voice session log view — it would need to read from either the voice agent API or a DB table
- Mobile telemetry endpoint exists (`MobileTelemetrySchema`, POST endpoint) but is not confirmed to be called by the mobile app currently

### What "working observability" looks like at launch

1. A developer can open `:9000/logs/viewer` and see every STT transcript, N8N request/response, and TTS text for the last 10 sessions
2. When an order fails to appear in the database, the log viewer shows exactly which step failed (N8N error, empty answer, STT mis-transcription)
3. The admin panel shows a list of voice sessions with room name, start time, duration, and outcome
4. The mobile app reports its own errors (connection failures, audio session errors) to the API telemetry endpoint

---

## Error States and Fallback Flows

Every failure mode needs a user-visible resolution path. Voice interfaces offer no visual error recovery — users are in a dark room talking to silence.

| Error State | Current Handling | Required Handling |
|-------------|-----------------|-------------------|
| Session start fails (API error) | Error message shown in HomeScreen | Good — keep this |
| Agent dispatch fails | Session blocked with error message (HomeScreen) | Good — but error message must be human-readable |
| n8n preflight fails | Alert with "Continue anyway?" option (mobile) | Good pattern; the check must be fast (< 2s) |
| Agent never joins room | 30s timeout + alert (mobile) | Good; needs to also log to mobile telemetry endpoint |
| Unexpected disconnect during session | Alert with End/Dismiss options (mobile) | Adequate for v1; should log the disconnect event |
| STT fails / returns empty | Agent currently falls back to log file scan — fragile | N8N should handle the empty turn gracefully; agent should say "Sorry, I didn't catch that" |
| N8N webhook returns empty answer | `retryable=False` error thrown; agent crashes the turn | Agent must surface "I'm having trouble connecting to the AI brain" to the user vocally |
| Session end webhook fails | Warning logged; silently dropped | Must retry at least once; if it fails, order must not be marked as placed |
| Order confirmation rejected by user | No current implementation | Agent must offer to cancel, modify, or place again |

---

## Competitor Feature Analysis

| Feature | Alexa/Google Shopping | Retell AI + n8n | Coziyoo Approach |
|---------|----------------------|-----------------|------------------|
| Session initiation | Wake word / tap | Inbound call or API | Tap in mobile app (no wake word) |
| STT provider | Proprietary (AWS/Google) | Configurable | Whisper-compatible HTTP STT (self-hosted) |
| LLM routing | Proprietary | Direct OpenAI or n8n | n8n as LLM brain (flexible, swappable) |
| Order confirmation UX | Summary read-back before purchase | Depends on workflow | Needs structured confirmation gate (not yet built) |
| Observability for developers | CloudWatch / Google Cloud Logging | Hamming AI, LiveKit Cloud | Self-hosted log viewer (good for cost; worse for features) |
| Fallback when AI fails | Redirect to app/website | Human transfer | Currently: session ends |

---

## Sources

- Codebase inspection: `apps/mobile/src/screens/VoiceSessionScreen.tsx`, `HomeScreen.tsx`, `apps/voice-agent/src/voice_agent/entrypoint.py`, `join_api.py`, `apps/api/src/routes/livekit.ts`
- [Building Production-Ready Voice Agents — Shekhar Gulati (2026)](https://shekhargulati.com/2026/01/03/building-production-ready-voice-agents/)
- [LiveKit Agent Observability — LiveKit Blog](https://blog.livekit.io/streamline-troubleshooting-with-agent-observability/)
- [LiveKit Agent Session Docs](https://docs.livekit.io/agents/logic/sessions/)
- [Why Fallback Systems Are Essential for Voice AI — CaseGen](https://www.casegen.ai/blogs/fallback-systems-voice-ai/)
- [Testing and Monitoring LiveKit Voice Agents in Production — Hamming AI](https://hamming.ai/resources/testing-and-monitoring-livekit-voice-agents-production)
- [Voice UI Design Best Practices 2026 — Eleken](https://www.eleken.co/blog-posts/voice-ui-design)
- [Voice Commerce and Confirmation UX — Cloudflight](https://www.cloudflight.io/en/blog/what-is-voice-commerce-and-how-its-transforming-ecommerce-in-2025/)
- [n8n Webhook Reliability and Retry Patterns — CodeSmith](https://www.codesmith.in/post/n8n-job-queue-webhook-callbacks)
- [Building AI Voice Agents with n8n — DEV Community](https://dev.to/mohammadarhamansari/building-ai-voice-agents-with-n8n-and-retell-ai-a-practical-guide-530l)
- [Voice UI Design Guide 2026 — FuseLab Creative](https://fuselabcreative.com/voice-user-interface-design-guide-2026/)

---

*Feature research for: voice-first food ordering marketplace (brownfield, reliability milestone)*
*Researched: 2026-03-12*
