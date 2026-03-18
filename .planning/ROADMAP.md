# Roadmap: Coziyoo v2

## Overview

Coziyoo v2 is a brownfield project where the core platform exists but the integration seams between mobile, API, voice agent, and n8n are broken or unverified. The roadmap repairs those seams in strict dependency order: database foundation first, then session startup, then observability, then the per-turn n8n loop, then order creation, then the UX layer that wraps the working loop, and finally user memory — which adds complexity and is only valuable after the core product demonstrably works.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Supabase DB Cutover** - Point API at Supabase; verify all existing functionality works
- [ ] **Phase 2: Voice Session Startup** - Mobile tap to agent join works reliably on physical devices
- [ ] **Phase 3: Observability** - Log viewer shows every session turn; engineers can debug the n8n chain
- [ ] **Phase 3.1: STT/TTS Preflight Checks** *(INSERTED)* - Mobile shows warning before session if STT or TTS server is unavailable
- [ ] **Phase 3.2: Mobile Login** *(INSERTED)* - User logs in with email/password before starting a voice session; real user identity flows through the session
- [ ] **Phase 4: Per-Turn N8N Integration** - Voice agent routes each turn through n8n for LLM response
- [ ] **Phase 5: Order Creation** - N8N detects confirmed intent and creates order in database
- [ ] **Phase 6: Post-Session UX** - User sees live conversation state and order summary after session
- [ ] **Phase 7: User Memory** - Agent remembers user preferences and past orders across sessions
- [ ] **Phase 8: Lots in Foods** - Sellers can define lot sizes for food items; buyers and voice agent interact with lot-based pricing

## Phase Details

### Phase 1: Supabase DB Cutover
**Goal**: API is connected to Supabase and all existing platform functionality works against it
**Depends on**: Nothing (first phase)
**Requirements**: DB-01, DB-02, DB-03
**Success Criteria** (what must be TRUE):
  1. API environment variables point to Supabase connection string; no local PostgreSQL is used
  2. Auth (login, token refresh), orders, payments, and finance endpoints return correct data from Supabase
  3. Memory tables (session memory and long-term memory) exist in the Supabase schema and are accessible
**Plans**: TBD

Plans:
- [x] 01-01: Swap API env vars to Supabase connection string and verify connectivity
- [x] 01-02: Run full API smoke test against Supabase (auth, orders, payments, finance)
- [x] 01-03: Create user memory tables (session_memory, long_term_memory) in Supabase schema

### Phase 2: Voice Session Startup
**Goal**: User taps Start on mobile and the voice agent joins the LiveKit room consistently on physical iOS and Android devices
**Depends on**: Phase 1
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, OBS-03, UX-02
**Success Criteria** (what must be TRUE):
  1. Agent worker process running status is verified before mobile attempts session dispatch; "agent unavailable" is shown immediately if worker is down
  2. Mobile successfully joins LiveKit room on physical iOS and physical Android device (audio session configured before connect)
  3. React Native New Architecture compatibility is resolved; LiveKit connects without errors
  4. Mobile displays connection status to user (connecting / connected / failed) throughout the session lifecycle
  5. N8N workflow activation state is verified before session dispatch; inactive workflow surfaces an error to mobile, not a silent hang
**Plans**: TBD

Plans:
- [x] 02-01: Fix agent worker health check to verify both join API and worker process; surface worker-not-running as error
- [x] 02-02: Validate and fix mobile iOS audio session configuration and Android audio session setup; test on physical devices
- [x] 02-03: Test and resolve React Native New Architecture + LiveKit compatibility (apply newArchEnabled mitigation if needed)
- [x] 02-04: Implement n8n workflow activation preflight check and connection status UI on mobile

### Phase 3: Observability
**Goal**: Engineers can see every voice session turn in the log viewer and distinguish real failures from missing data
**Depends on**: Phase 2
**Requirements**: OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. Log viewer at :9000/logs/viewer shows voice sessions grouped by room_id and job_id; entries are not orphaned under "unknown"
  2. Each turn entry shows STT input, n8n request payload, n8n response, and TTS output
  3. Log viewer shows a clear "no sessions yet" message when the log file is missing versus "no entries" when the file is empty
**Plans**: TBD

Plans:
- [x] 03-01: Add room_id and job_id to all n8n log extra fields; fix session grouping in log viewer
- [x] 03-02: Add STT, n8n request/response, and TTS output to per-turn log entries; fix "file not found" vs "file empty" distinction in /logs/requests response

### Phase 3.1: STT/TTS Preflight Checks *(INSERTED)*
**Goal**: Mobile shows a clear warning before attempting to start a session when STT or TTS servers are unreachable
**Depends on**: Phase 3
**Requirements**: SESS-06
**Success Criteria** (what must be TRUE):
  1. Before session dispatch, the API checks STT and TTS health endpoints and returns a structured error if either is down
  2. Mobile displays a specific warning (e.g. "Speech recognition unavailable" / "Voice synthesis unavailable") — not a generic error
  3. Session is not attempted when either service is unhealthy; user can retry once resolved
**Plans**: TBD

Plans:
- [x] 3.1-01: Add STT/TTS health check to session dispatch preflight; surface service-specific errors to mobile

### Phase 3.2: Mobile Login *(INSERTED)*
**Goal**: User logs in with email and password before starting a voice session; real user identity flows through the session
**Depends on**: Phase 3.1
**Requirements**: AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):
  1. Mobile has a Login screen (email + password) that calls `POST /v1/auth/login` and stores access + refresh tokens in AsyncStorage
  2. On app launch, if valid tokens exist the user is taken directly to Home screen; if not, they see Login
  3. Session start uses the authenticated `POST /v1/livekit/session/start` endpoint with Bearer token instead of the unauthenticated starter endpoint
  4. Token refresh (401 → refresh → retry) is handled transparently so the user is never unexpectedly dropped to login mid-session
  5. A logout button clears stored tokens and returns the user to the Login screen
**Plans**: TBD

Plans:
- [x] 3.2-01: Add Login screen with email/password form; call auth API, persist tokens in AsyncStorage; auto-navigate on launch if tokens exist
- [x] 3.2-02: Switch session start to authenticated endpoint; wire user identity into session metadata; add logout

### Phase 4: Per-Turn N8N Integration
**Goal**: Every voice turn is processed by n8n and returns an LLM-generated reply to the voice agent without timeouts
**Depends on**: Phase 3
**Requirements**: TURN-01, TURN-02, TURN-03, TURN-04, TURN-05
**Success Criteria** (what must be TRUE):
  1. Voice agent sends each user turn to n8n with session ID; n8n maintains session state across turns
  2. N8N webhook URL resolves through a single consistent path on both API and voice agent sides; no competing configurations
  3. N8N workflow uses "Respond to Webhook" node and returns a reply before the 60-second timeout
  4. Voice agent correctly parses `{ "replyText": "..." }` from n8n response and speaks it back
  5. AI_SERVER_SHARED_SECRET is required (not optional) and validated at startup on both API and voice agent; missing secret fails fast with a clear error
**Plans**: TBD

Plans:
- [x] 04-01: Make AI_SERVER_SHARED_SECRET required in env schema; add startup validation on API and voice agent
- [x] 04-02: Audit and consolidate n8n webhook URL resolution to a single path; add startup diagnostics logging for resolved URLs
- [x] 04-03: Configure n8n per-turn LLM workflow to use "Respond to Webhook" node and return correct response shape
- [x] 04-04: Verify end-to-end per-turn flow: mobile speech → STT → n8n → replyText → TTS → audio in room

### Phase 4.1: Voice Food Discovery *(INSERTED)*
**Goal**: Users can search, browse, compare, and select food items by voice. A single consolidated brain workflow handles all intents using LLM nodes and direct API/Supabase calls — no separate MCP gateway.
**Depends on**: Phase 4
**Requirements**: TURN-03, ORD-01
**Success Criteria** (what must be TRUE):
  1. Brain workflow routes all intents through a Switch node; no separate MCP gateway workflow is called
  2. menu_browse and product_search intents call `GET /v1/voice/foods` and the Reply LLM describes results naturally
  3. add_to_cart intent resolves a real lotId from the foods API and writes it to `session_memory.cart` in Supabase
  4. checkout intent reads `session_memory.cart`, calls `POST /v1/orders/voice`, and speaks order confirmation with orderId
  5. Code nodes are minimal — LLM nodes handle intent classification and all natural language formatting
**Plans**: TBD

Plans:
- [ ] 4.1-01: Redesign brain workflow — Switch-based routing, food discovery branches, add_to_cart memory write, checkout order creation

### Phase 5: Order Creation
**Goal**: When a user verbally confirms an order during a session, n8n creates the order record and notifies the cook
**Depends on**: Phase 4
**Requirements**: ORD-01, ORD-02, ORD-05, DB-04
**Success Criteria** (what must be TRUE):
  1. N8N detects verbal order confirmation from a conversation turn and distinguishes it from general food discussion
  2. An order record appears in Supabase after a confirmed order conversation; order has correct items, user, and cook references
  3. Cook receives a notification after order creation
  4. N8N reads and writes user session data in Supabase during voice sessions (memory reads/writes work against Supabase)
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — Add POST /v1/orders/voice internal endpoint + configure n8n Supabase credential (ORD-02, DB-04)
- [ ] 05-02-PLAN.md — Wire n8n brain workflow: add_to_cart memory write + checkout → order creation API call (ORD-01, ORD-02, DB-04)
- [ ] 05-03-PLAN.md — Cook notification endpoint + end-to-end Phase 5 verification (ORD-01, ORD-05)

### Phase 6: Post-Session UX
**Goal**: User sees live conversation state during the session and an order summary (or no-order outcome) when the session ends
**Depends on**: Phase 5
**Requirements**: ORD-03, ORD-04, UX-01
**Success Criteria** (what must be TRUE):
  1. Voice session screen shows live state (listening / thinking / speaking) that matches actual agent activity
  2. Voice agent sends order summary to mobile via LiveKit data channel after order creation
  3. Mobile shows a post-session screen with order ID and items when an order was placed, or a clear "no order placed" message otherwise
**Plans**: TBD

Plans:
- [ ] 06-01: Implement live conversation state display on VoiceSessionScreen (listening / thinking / speaking)
- [ ] 06-02: Wire voice agent to send order summary via LiveKit data channel on order creation
- [ ] 06-03: Build post-session order summary screen on mobile; handle both order-placed and no-order outcomes

### Phase 7: User Memory
**Goal**: Agent remembers user dietary preferences, past orders, and conversation style across sessions
**Depends on**: Phase 6
**Requirements**: SESS-05, MEM-01, MEM-02, MEM-03, MEM-04
**Success Criteria** (what must be TRUE):
  1. User long-term memory (past orders, dietary preferences, personal details, conversation style) is stored in Supabase
  2. N8N reads user memory from Supabase at session start and injects it into the LLM context
  3. N8N updates user memory in Supabase when new preferences or personal details are captured during a conversation
  4. Memory schema supports both structured data (tables) and semantic data (pgvector for conversation style)
  5. Voice agent loads user long-term memory from Supabase at session start and makes it available to n8n
**Plans**: TBD

Plans:
- [ ] 07-01: Design and create user memory schema in Supabase (structured tables + pgvector for semantic memory)
- [ ] 07-02: Implement n8n memory read at session start and injection into LLM context
- [ ] 07-03: Implement n8n memory write on preference/detail capture during conversation
- [ ] 07-04: Wire voice agent to fetch and pass user long-term memory at session start

### Phase 8: Lots in Foods
**Goal**: Admin can see lot lifecycle status and ingredient/allergen variations per lot clearly, and export that data as a report
**Depends on**: None (admin panel only — independent of voice agent phases)
**Requirements**: LOTS-01, LOTS-02, LOTS-03, LOTS-04, LOTS-05
**Success Criteria** (what must be TRUE):
  1. Inline lot rows in FoodsLotsPage show lifecycle status (color-coded pill), quantity, and a variation badge when a lot's snapshot differs from the current food recipe/ingredients/allergens
  2. Lot detail modal calls `computeFoodLotDiff()` and highlights which fields (recipe / ingredients / allergens) changed versus the base food
  3. Foods table has a "has variations" filter to surface only foods with at least one lot that diverges from the current recipe
  4. Excel export includes diff status (recipe changed / ingredients changed / allergens changed) per lot row
**Plans**: 3 plans

Plans:
- [x] 08-01-PLAN.md — Lifecycle status pill and quantity columns in inline lot rows (LOTS-01)
- [x] 08-02-PLAN.md — Variation badges in inline lot rows and diff highlights in lot detail modal (LOTS-02, LOTS-03)
- [ ] 08-03-PLAN.md — Has-variations filter chip and Excel export diff columns (LOTS-04, LOTS-05)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Supabase DB Cutover | 3/3 | Completed | 2026-03-12 |
| 2. Voice Session Startup | 4/4 | Completed | 2026-03-13 |
| 3. Observability | 2/2 | Completed | 2026-03-13 |
| 3.1. STT/TTS Preflight Checks | 1/1 | Completed | 2026-03-16 |
| 3.2. Mobile Login | 2/2 | Completed | 2026-03-16 |
| 4. Per-Turn N8N Integration | 4/4 | Completed | 2026-03-17 |
| 4.1. Voice Food Discovery | 0/1 | Not started | - |
| 5. Order Creation | 0/3 | Not started | - |
| 6. Post-Session UX | 0/3 | Not started | - |
| 7. User Memory | 0/4 | Not started | - |
| 8. Lots in Foods | 3/3 | Completed | 2026-03-15 |
