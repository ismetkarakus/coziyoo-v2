# Requirements: Coziyoo v2

**Defined:** 2026-03-12
**Core Value:** Buyer opens mobile app, speaks to AI agent, and their order is placed — no tapping required.

## v1 Requirements

### Session Startup (SESS)

- [ ] **SESS-01**: Voice agent worker process is verified running before session is dispatched from mobile
- [ ] **SESS-02**: Mobile app requests and joins LiveKit room reliably (iOS + Android audio session configured correctly before connect)
- [ ] **SESS-03**: React Native New Architecture compatibility is resolved (newArchEnabled diagnostic applied)
- [ ] **SESS-04**: Mobile app displays connection status to user (connecting / connected / failed)
- [ ] **SESS-05**: Voice agent loads user's long-term memory from Supabase at session start

### Database Migration (DB)

- [ ] **DB-01**: API environment updated to point to Supabase PostgreSQL (connection string swap via env vars — no code changes)
- [ ] **DB-02**: All existing API functionality verified working against Supabase (orders, auth, payments, finance)
- [ ] **DB-03**: User memory tables (session memory + long-term memory) created in Supabase schema
- [ ] **DB-04**: N8N connects to Supabase for memory reads/writes during voice sessions

### Per-Turn N8N Integration (TURN)

- [ ] **TURN-01**: Voice agent sends each user turn to n8n webhook with session ID for state management
- [ ] **TURN-02**: N8N webhook URL is configured consistently (single resolution path, no competing configs)
- [ ] **TURN-03**: N8N LLM workflow uses "Respond to Webhook" node mode (not end-of-workflow) to avoid turn timeouts
- [ ] **TURN-04**: N8N returns `{ "replyText": "..." }` response shape that voice agent can parse
- [ ] **TURN-05**: AI_SERVER_SHARED_SECRET is required (not optional) and validated on both API and voice agent sides

### User Memory (MEM)

- [ ] **MEM-01**: User long-term memory stored in Supabase (past orders, dietary preferences, personal details, conversation style)
- [ ] **MEM-02**: N8N reads user memory from Supabase at session start and injects into LLM context
- [ ] **MEM-03**: N8N updates user memory in Supabase when new preferences or personal details are captured during conversation
- [ ] **MEM-04**: Memory schema supports both structured data (tables) and semantic data (pgvector for conversation style)

### Order Creation (ORD)

- [ ] **ORD-01**: N8N detects confirmed order intent from user verbal confirmation during a conversation turn
- [ ] **ORD-02**: N8N creates order record in Supabase/PostgreSQL when order intent is confirmed
- [ ] **ORD-03**: Voice agent sends order summary to mobile via LiveKit data channel after order is created
- [ ] **ORD-04**: Mobile app shows post-session order summary screen after voice session ends
- [ ] **ORD-05**: N8N sends notification to cook after order creation

### Observability (OBS)

- [ ] **OBS-01**: Log viewer at :9000/logs/viewer shows voice sessions with correct grouping (n8n log entries include room_id and job_id fields)
- [ ] **OBS-02**: Each voice turn logs STT input, n8n request/response, and TTS output per session
- [ ] **OBS-03**: N8N workflow activation state is verified before session dispatch (active = webhook responds, not just exists)

### Mobile UX (UX)

- [ ] **UX-01**: Voice session screen shows live conversation state (listening / thinking / speaking)
- [ ] **UX-02**: Error states are handled gracefully (failed to connect, voice agent unavailable, order failed)

## v2 Requirements

### Cook Flow

- **COOK-01**: Cook receives order notification in mobile app
- **COOK-02**: Cook can accept/reject orders via mobile
- **COOK-03**: Cook voice management of their food lots

### Admin Panel

- **ADMIN-01**: Admin can manage cooks and buyer accounts
- **ADMIN-02**: Admin can monitor all orders and their status
- **ADMIN-03**: Admin can view voice session logs from admin panel
- **ADMIN-04**: Admin can configure/trigger n8n workflows from admin panel

### Advanced Memory

- **MEM-V2-01**: Cross-session conversation summaries stored as vector embeddings
- **MEM-V2-02**: Personalized menu recommendations based on order history

### Reliability

- **REL-01**: Session-end fallback webhook for cleanup (separate from per-turn LLM calls)
- **REL-02**: Structured outcome signals (order_placed / no_order / error) from n8n to API
- **REL-03**: Outbox pattern for reliable event delivery if n8n is temporarily unavailable

### Lots in Foods (LOTS)

- [ ] **LOTS-01**: Inline lot rows in FoodsLotsPage show lifecycle status (color-coded pill using `lotLifecycleClass()`), quantity available/produced, and sale window
- [ ] **LOTS-02**: Variation badge appears on lot rows when `computeFoodLotDiff()` detects that a lot's snapshot differs from the current food recipe, ingredients, or allergens
- [ ] **LOTS-03**: Lot detail modal highlights which specific fields (recipe / ingredients / allergens) changed versus the current food recipe, using `computeFoodLotDiff()` diff result
- [ ] **LOTS-04**: Main foods table has a "has variations" filter that shows only foods with at least one lot whose snapshot differs from the current food
- [ ] **LOTS-05**: Excel export for lot detail includes diff status (recipe changed / ingredients changed / allergens changed) per lot row

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cook voice ordering | Cook flow not yet defined — buyer voice first |
| Real-time order tracking during session | Breaks conversation flow |
| OAuth / social login | Email/password sufficient for v1 |
| Web storefront | Mobile-first platform |
| Admin panel (v1) | Secondary to voice ordering flow working |
| Automated order placement without confirmation | Trust-destroying — verbal confirm required |

## Traceability

Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01 | Phase 1 | Pending |
| DB-02 | Phase 1 | Pending |
| DB-03 | Phase 1 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 2 | Pending |
| SESS-04 | Phase 2 | Pending |
| OBS-03 | Phase 2 | Pending |
| UX-02 | Phase 2 | Pending |
| OBS-01 | Phase 3 | Pending |
| OBS-02 | Phase 3 | Pending |
| TURN-01 | Phase 4 | Pending |
| TURN-02 | Phase 4 | Pending |
| TURN-03 | Phase 4 | Pending |
| TURN-04 | Phase 4 | Pending |
| TURN-05 | Phase 4 | Pending |
| ORD-01 | Phase 5 | Pending |
| ORD-02 | Phase 5 | Pending |
| ORD-05 | Phase 5 | Pending |
| DB-04 | Phase 5 | Pending |
| ORD-03 | Phase 6 | Pending |
| ORD-04 | Phase 6 | Pending |
| UX-01 | Phase 6 | Pending |
| SESS-05 | Phase 7 | Pending |
| MEM-01 | Phase 7 | Pending |
| MEM-02 | Phase 7 | Pending |
| MEM-03 | Phase 7 | Pending |
| MEM-04 | Phase 7 | Pending |
| LOTS-01 | Phase 8 | Pending |
| LOTS-02 | Phase 8 | Pending |
| LOTS-03 | Phase 8 | Pending |
| LOTS-04 | Phase 8 | Pending |
| LOTS-05 | Phase 8 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓
- Phase 8 (LOTS): 5 requirements added 2026-03-15

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 after roadmap creation*
