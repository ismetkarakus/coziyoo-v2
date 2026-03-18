# Phase 5: Order Creation - Research

**Researched:** 2026-03-17
**Domain:** N8N workflow automation, PostgreSQL/Supabase, Express API order creation, cook notifications
**Confidence:** HIGH (all findings from direct source code inspection)

---

## Summary

Phase 5 wires verbal order confirmation (in voice session) all the way through to a persisted order record and cook notification. The critical integration path is: user says "yes, place my order" → n8n brain workflow detects `checkout` intent → a new n8n sub-workflow calls the API's `POST /v1/orders` endpoint → order record written to Supabase → outbox event queued → cook notified.

The good news: the API endpoint `POST /v1/orders` is fully implemented and production-ready with lot-based stock validation, idempotency, and outbox events. The session memory table (`session_memory`) already exists in Supabase via migration `0006_user_memory_tables.sql`. The n8n brain workflow already classifies `checkout` intent. What does NOT yet exist is: (a) any n8n action that actually calls `POST /v1/orders` when checkout intent fires, (b) a cook notification step, and (c) a session-memory write to persist the cart state across turns so that n8n knows *what* to order when checkout is detected.

The session-end webhook path (voice agent → API `/v1/livekit/session/end` → n8n `session-end` tool webhook) fires at end-of-call and is a viable trigger point, but per-turn triggering on `checkout` intent is faster and the right UX. Both paths must be considered.

**Primary recommendation:** Add an `order.create` action to the MCP Gateway workflow (or wire directly from the brain workflow's `checkout` branch) that POSTs to `http://127.0.0.1:3000/v1/orders` using a pre-minted buyer JWT stored in Supabase `session_memory`, then notify the cook via the outbox/push mechanism.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ORD-01 | N8N detects confirmed order intent from user verbal confirmation | Brain workflow already classifies `checkout` intent; needs a branch action that calls the order API |
| ORD-02 | N8N creates order record in Supabase/PostgreSQL when order intent is confirmed | `POST /v1/orders` endpoint fully implemented; n8n needs a buyer JWT + cart payload from session_memory |
| ORD-03 | Voice agent sends order summary to mobile via LiveKit data channel after order is created | LiveKit `sendRoomData` service exists in API; n8n can call it or a new API webhook can emit it |
| ORD-04 | Mobile app shows post-session order summary screen after voice session ends | Out of scope for this phase (mobile UX) — referenced for awareness only |
| ORD-05 | N8N sends notification to cook after order creation | Outbox event `order_created` is already enqueued by `POST /v1/orders`; cook notification requires an outbox consumer or a direct n8n call |
</phase_requirements>

---

## Standard Stack

### Core

| Library / Service | Version | Purpose | Why Standard |
|---|---|---|---|
| n8n (existing) | hosted | Workflow automation, intent detection, order API calls | Already in use for brain and MCP workflows |
| Express API `POST /v1/orders` | existing | Creates order records transactionally | Fully implemented with all validations |
| PostgreSQL `session_memory` table | existing | Per-session cart state storage keyed by `room_id` | Already migrated, unique index on `room_id` |
| PostgreSQL `outbox_events` table | existing | Async event queue for order_created notifications | Used by the existing orders route |
| n8n Supabase credential | to configure | Allows n8n to read/write Postgres directly | Standard n8n node for PostgreSQL |

### Supporting

| Library / Service | Version | Purpose | When to Use |
|---|---|---|---|
| n8n HTTP Request node | existing | Calls `POST /v1/orders` from n8n | For order creation step |
| n8n Code node | existing | Parse intent data, build order payload | For transforming session_memory data to API body |
| `AI_SERVER_SHARED_SECRET` | existing | Authenticates internal service calls | Already used for session-end webhook |

---

## Architecture Patterns

### Recommended Project Structure

```
apps/voice-agent/workflows/
├── brain_6KFFgjd26nF0kNCA.json       # existing — add checkout branch
├── mcp_XYiIkxpa4PlnddQt.json         # existing — add order.create action
└── order_create_<id>.json             # NEW — dedicated order creation workflow (optional)
```

### Pattern 1: Checkout Intent Branch in Brain Workflow

**What:** When `intent === 'checkout'`, instead of (or after) generating a reply, the brain workflow triggers an order creation sub-step.

**When to use:** For immediate per-turn order creation on the same webhook call as the user's confirmation.

**Structure:**
```
Parse Intent
  └── Needs MCP? (existing IF node)
       └── [false branch, intent=checkout] → NEW: "Is Checkout?" IF node
            └── [true] → Read session_memory from Supabase → Build Order Payload → POST /v1/orders → Write orderId to session_memory → Reply with confirmation
            └── [false] → existing Merge Context
```

**Key insight:** The brain workflow is synchronous (respond-to-webhook mode). Order creation can happen *within* the same webhook execution before the reply is returned to the voice agent.

### Pattern 2: MCP Gateway `order.create` Action

**What:** Add `order.create` as a new action to the MCP Gateway workflow. Brain calls MCP with `action: 'order.create'` when checkout fires.

**When to use:** Preferred for separation of concerns — keeps the brain workflow thin.

**MCP payload:**
```json
{
  "action": "order.create",
  "params": {
    "roomId": "{{roomId}}",
    "buyerJwt": "{{from session_memory}}",
    "sellerId": "{{from session_memory}}",
    "deliveryType": "pickup",
    "items": [{ "lotId": "...", "quantity": 1 }]
  }
}
```

### Pattern 3: Session Memory as Cart State

**What:** Each `add_to_cart` turn writes the accumulated cart to `session_memory.data` in Supabase, keyed by `room_id`. At checkout, n8n reads this to build the order payload.

**Schema slot in `session_memory.data` (JSONB):**
```json
{
  "cart": [
    { "lotId": "uuid", "foodName": "Lamb Kebab", "quantity": 2, "unitPrice": 8.50 }
  ],
  "sellerId": "uuid",
  "deliveryType": "pickup",
  "buyerJwt": "Bearer eyJ..."
}
```

**Critical:** `session_memory` is keyed by `room_id` with a unique index. N8N can upsert by `room_id` using a Supabase/Postgres node.

### Anti-Patterns to Avoid

- **Calling `POST /v1/orders` without idempotency key:** The endpoint requires `Idempotency-Key` header (middleware `requireIdempotency`). N8N must send a unique key per order attempt (use `traceId` or `roomId + timestamp`).
- **Using admin JWT to create orders:** `POST /v1/orders` requires `app` realm JWT with buyer role. An admin token will be rejected with `ROLE_NOT_ALLOWED`.
- **Trying to infer lotId from productName alone:** The order endpoint needs a `lotId` (UUID) not a product name. The cart in session_memory must store `lotId` values obtained from the RAG/MCP foods lookup.
- **Using session-end webhook as the primary order trigger:** It fires after the room disconnects — too late for good UX. Use per-turn checkout detection instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Order creation with stock validation | Custom SQL insert | `POST /v1/orders` API endpoint | Handles lot validation, FEFO allocation, compliance checks, outbox event, atomic transaction |
| Cart state persistence | In-memory n8n variable | `session_memory` Supabase table | Survives n8n restarts; already exists; keyed by room_id |
| Cook notification | Direct push notification call | `outbox_events` consumer or n8n `order_created` outbox trigger | Outbox pattern already in place; `order_created` event is enqueued automatically by the orders route |
| Idempotency | Custom dedup logic | Standard `Idempotency-Key` header | API middleware already handles this |

**Key insight:** The `POST /v1/orders` endpoint does the heavy lifting. N8N's only job is: (1) detect confirmed checkout intent, (2) read cart from session_memory, (3) call the API with a valid buyer JWT, (4) handle the response.

---

## Common Pitfalls

### Pitfall 1: Missing Buyer JWT in N8N

**What goes wrong:** N8N has no way to authenticate as the buyer when calling `POST /v1/orders`. The endpoint requires `requireAuth("app")` — a valid `app` realm JWT with buyer role.

**Why it happens:** N8N runs server-side, not in the context of the authenticated mobile user.

**How to avoid:** Store the buyer's app JWT in `session_memory.data.buyerJwt` at session start (mobile → API → n8n or API → session_memory at `/v1/livekit/session/start`). Alternatively, add a dedicated internal API endpoint that accepts `AI_SERVER_SHARED_SECRET` to create orders on behalf of a user by `userId`, bypassing JWT auth. The latter avoids JWT expiry issues.

**Warning signs:** N8N HTTP Request node returns 401 when calling `POST /v1/orders`.

### Pitfall 2: Missing `Idempotency-Key` Header

**What goes wrong:** N8N calls `POST /v1/orders` without an `Idempotency-Key` header. The middleware at scope `order_create` requires it. Returns 400 or 422.

**Why it happens:** N8N HTTP Request node does not add custom headers by default.

**How to avoid:** Add `Idempotency-Key: {{$json.traceId}}-order` header in the n8n HTTP Request node.

**Warning signs:** Response is `400 VALIDATION_ERROR` or `422` with no order created.

### Pitfall 3: Cart Contains Product Names but Not LotIds

**What goes wrong:** When building the order payload, items have `foodId` or `productName` but not `lotId`. The order endpoint requires `lotId` (a `production_lots.id` UUID), not `food_id`.

**Why it happens:** The RAG/MCP foods API returns `food.id` and `food.name`, not `lot.id`. The lotId comes from a separate lots query.

**How to avoid:** When the user says "add X to cart", the brain workflow must store `lotId` (from `production_lots`) in session_memory, not just `foodId`. Ensure the MCP/RAG foods endpoint returns `lotId` or that a separate lots lookup is done at add-to-cart time.

**Warning signs:** `POST /v1/orders` returns `LOT_NOT_FOUND`.

### Pitfall 4: `checkout` Intent Without Cart Data

**What goes wrong:** User says "place the order" but session_memory has no cart entries because `add_to_cart` turns didn't write to Supabase.

**Why it happens:** Session memory writes are not yet implemented for `add_to_cart` intent.

**How to avoid:** Implement `add_to_cart` → Supabase `session_memory` write in the same phase, before the checkout detection step.

**Warning signs:** N8N reads empty cart from `session_memory` and cannot build `items` array.

### Pitfall 5: N8N Supabase Credential Scope

**What goes wrong:** N8N's Postgres credential connects to Supabase but has insufficient permissions to write to `session_memory` or read from `orders`.

**Why it happens:** Supabase RLS (Row Level Security) or schema permissions not granted to the service role.

**How to avoid:** Use the Supabase `service_role` key (bypasses RLS) in n8n credentials, not the `anon` key.

### Pitfall 6: Cook Notification Gap

**What goes wrong:** The `order_created` outbox event is enqueued, but no outbox consumer exists to fan it out to the cook's device (push notification, WebSocket, etc.).

**Why it happens:** The outbox pattern exists but the `order_created` consumer (push notification, FCM, etc.) is not yet implemented.

**How to avoid:** For this phase, n8n can serve as the consumer — add a Supabase trigger node or scheduled poll in n8n to detect new `outbox_events` with `event_type = 'order_created'` and send a push notification or in-app event. The cook notification step (ORD-05) can be wired directly in n8n after the order creation HTTP call, before returning the reply.

---

## Code Examples

Verified patterns from source code:

### POST /v1/orders — Request Shape

```typescript
// Source: apps/api/src/routes/orders.ts — CreateOrderSchema
// Required headers:
//   Authorization: Bearer <app-realm-buyer-jwt>
//   Content-Type: application/json
//   Idempotency-Key: <unique string per attempt>
// Required body:
{
  "sellerId": "uuid",                    // required
  "deliveryType": "pickup" | "delivery", // required
  "deliveryAddress": {},                 // optional, required if deliveryType=delivery
  "requestedAt": "ISO8601",              // optional
  "items": [                             // min 1 item
    {
      "lotId": "uuid",   // production_lots.id — NOT food.id
      "quantity": 1      // positive integer
    }
  ]
}
// 201 response:
{
  "data": {
    "orderId": "uuid",
    "status": "pending_seller_approval",
    "totalPrice": 17.50
  }
}
```

### session_memory Table Schema

```sql
-- Source: apps/api/src/db/migrations/0006_user_memory_tables.sql
CREATE TABLE IF NOT EXISTS public.session_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id text NOT NULL,                         -- LiveKit room name
    user_id uuid REFERENCES public.users(id),      -- nullable (anon sessions)
    data jsonb NOT NULL DEFAULT '{}'::jsonb,        -- cart, buyerJwt, etc.
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT session_memory_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_memory_room_id
    ON public.session_memory USING btree (room_id);
```

### N8N Supabase Upsert for session_memory (conceptual)

```javascript
// N8N Code node — upsert cart item to session_memory by room_id
// Uses n8n Postgres node with:
//   Query: INSERT INTO session_memory (room_id, data) VALUES ($1, $2)
//          ON CONFLICT (room_id) DO UPDATE SET
//            data = session_memory.data || $2,
//            updated_at = now()
// $1 = {{ $json.roomId }}
// $2 = JSON.stringify({ cart: updatedCart, sellerId: ..., buyerJwt: ... })
```

### N8N Brain Workflow — Checkout Branch (new node to add)

```javascript
// After Parse Intent, add an IF node: "Is Checkout?"
// Condition: $json.intent === 'checkout'
// True branch:
//   1. Supabase Postgres node: SELECT data FROM session_memory WHERE room_id = '{{roomId}}'
//   2. Code node: Build order payload from data.cart, data.sellerId, data.buyerJwt
//   3. HTTP Request node: POST http://127.0.0.1:3000/v1/orders
//      Headers: Authorization: {{data.buyerJwt}}, Idempotency-Key: {{traceId}}-order
//   4. Code node: Format reply "Your order has been placed! Order ID: {{orderId}}"
//   5. (Optional) HTTP Request: notify cook via API or direct push
// False branch: existing flow
```

### End-of-Call Webhook Payload

```typescript
// Source: apps/voice-agent/src/voice_agent/entrypoint.py — _notify_session_end()
// POST {API_BASE_URL}/v1/livekit/session/end
// Headers: x-ai-server-secret: {AI_SERVER_SHARED_SECRET}
{
  "roomName": "coziyoo-room-xyz",
  "summary": "Voice session completed.",
  "startedAt": "2026-03-17T10:00:00Z",
  "endedAt": "2026-03-17T10:05:00Z",
  "outcome": "completed",
  "deviceId": "abc123"     // optional
}
// API then calls n8n tool webhook at:
// {N8N_HOST}/webhook/coziyoo/session-end
```

### N8N to API Authentication

```typescript
// Source: apps/api/src/services/n8n.ts — buildHeaders()
// N8N calls API internal endpoints using:
//   x-n8n-api-key: {N8N_API_KEY}
//   Authorization: Bearer {N8N_API_KEY}

// Source: apps/api/src/routes/livekit.ts — isValidSharedSecret()
// AI_SERVER_SHARED_SECRET is used for:
//   - Voice agent → API (/v1/livekit/session/end)
//   - API → voice agent join API (/livekit/agent-session)

// For n8n calling POST /v1/orders (app realm):
// Needs a buyer-scoped app JWT — NOT N8N_API_KEY (which has no app auth)
// Options:
//   A) Store buyer JWT in session_memory at session start
//   B) Add internal order-creation endpoint protected by AI_SERVER_SHARED_SECRET + userId
```

### Order State Machine

```typescript
// Source: apps/api/src/services/order-state-machine.ts
// Initial status: 'pending_seller_approval'
// Seller can transition to: seller_approved → awaiting_payment → paid → preparing → ready → delivered
// Buyer can: cancel, complete
// Cook notification needed at: 'pending_seller_approval' (new order arrived)
```

---

## State of the Art

| Old Approach | Current Approach | Status | Impact |
|---|---|---|---|
| N8N calls orders API directly with admin token | Store buyer JWT in session_memory at session start | Needs implementation | Enables authenticated order creation from n8n |
| End-of-call order creation | Per-turn checkout detection | Recommended | Faster UX, no need to wait for session end |
| Outbox polling for cook notification | Inline n8n cook notification step | Acceptable for v1 | Simpler, avoids implementing separate outbox consumer |

**Current gaps (NOT yet implemented):**
- `add_to_cart` intent does NOT write to `session_memory` (it only sends a UI action to mobile)
- `checkout` intent has no API call — brain workflow just navigates to Cart screen
- `session_memory` is not populated with `buyerJwt` at session start
- N8N MCP workflow `orders.status` action is a stub returning `NOT_IMPLEMENTED`
- No cook notification mechanism beyond the outbox event enqueue

---

## Open Questions

1. **How does n8n authenticate as the buyer to call `POST /v1/orders`?**
   - What we know: The endpoint requires `requireAuth("app")` with buyer role JWT. N8N has no buyer JWT by default.
   - What's unclear: Whether to store the JWT in session_memory or add a bypass endpoint.
   - Recommendation: Add a new internal endpoint `POST /v1/orders/voice` protected by `AI_SERVER_SHARED_SECRET + userId` that creates orders on behalf of a buyer without needing their JWT. This is cleaner and avoids JWT expiry issues.

2. **Where do lotIds come from at add-to-cart time?**
   - What we know: MCP/RAG returns `food.id` and `food.name`. The orders endpoint needs `lot.id`.
   - What's unclear: Whether `/v1/voice/foods` returns `lotId` alongside food info.
   - Recommendation: Check `/v1/voice/foods` endpoint — if it doesn't return `lotId`, add lot info to its response. This is a prerequisite for order creation.

3. **What is the cook notification mechanism for v1?**
   - What we know: `outbox_events` table gets `order_created` event. No consumer exists yet.
   - What's unclear: Whether push notifications (FCM/APNs) are configured, or if a simpler in-app poll is acceptable.
   - Recommendation: For v1, wire n8n to send a direct HTTP notification or use a simple Supabase realtime subscription. Do not block order creation on notification delivery.

4. **Does the brain workflow need cart state across turns?**
   - What we know: Currently each n8n webhook call is stateless — only the last 10 messages from conversation history are passed.
   - What's unclear: Whether the LLM can infer the full cart from conversation history alone.
   - Recommendation: Explicitly write cart to `session_memory` on every `add_to_cart` intent for reliability. Don't rely on LLM to reconstruct cart from conversation history.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (apps/api) |
| Config file | apps/api/vitest.config.ts |
| Quick run command | `npm run test --workspace=apps/api -- --run apps/api/tests/unit/orders.test.ts` |
| Full suite command | `npm run test:api` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORD-01 | N8N checkout intent detected from conversation | manual | Run voice session, say "yes place my order" | N/A — n8n workflow |
| ORD-02 | Order record created in Supabase after checkout | integration | `npm run test --workspace=apps/api -- --run apps/api/tests/unit/orders-voice.test.ts` | Wave 0 |
| ORD-03 | Order summary sent to mobile via data channel | manual | Verify mobile receives data channel message | N/A |
| ORD-04 | Cook receives notification | manual | Verify cook notification arrives | N/A |
| ORD-05 | N8N sends cook notification | integration | Verify outbox event or direct notification fires | manual check |

### Sampling Rate
- **Per task commit:** `npm run test:api -- --run`
- **Per wave merge:** `npm run test:api`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/api/tests/unit/orders-voice.test.ts` — covers ORD-02: tests voice order creation endpoint (if added)
- [ ] Verify `session_memory` upsert query works against Supabase

---

## Sources

### Primary (HIGH confidence)
- `apps/api/src/routes/orders.ts` — full order creation endpoint implementation
- `apps/api/src/db/migrations/0006_user_memory_tables.sql` — session_memory schema
- `apps/api/src/services/order-state-machine.ts` — order status transitions
- `apps/api/src/services/n8n.ts` — n8n service: sendSessionEndEvent, auth headers
- `apps/api/src/services/outbox.ts` — outbox event enqueue
- `apps/api/src/config/env.ts` — all env vars including N8N_HOST, N8N_API_KEY
- `apps/voice-agent/src/voice_agent/entrypoint.py` — _notify_session_end, N8nLLM, payload shape
- `apps/voice-agent/workflows/brain_6KFFgjd26nF0kNCA.json` — intent detection, checkout branch (absent)
- `apps/voice-agent/workflows/mcp_XYiIkxpa4PlnddQt.json` — MCP actions (orders.status = stub)
- `.env.local` variable names (values redacted) — confirms N8N_HOST, N8N_API_KEY, SUPABASE vars all present

### Secondary (MEDIUM confidence)
- `apps/api/src/routes/livekit.ts` — session/end handler, n8n tool webhook call pattern
- `apps/api/src/db/migrations/0001_initial_schema.sql` — orders table structure (confirmed via route code)

---

## Metadata

**Confidence breakdown:**
- API endpoint shape: HIGH — read directly from source
- N8N workflow structure: HIGH — read JSON files directly
- Session memory schema: HIGH — read migration SQL directly
- Authentication approach: HIGH — traced through env.ts and n8n.ts
- Cook notification: MEDIUM — outbox event confirmed, consumer not yet built
- LotId availability in foods API: LOW — `/v1/voice/foods` endpoint not read (needs investigation in plan)

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable codebase; re-verify if voice agent or orders route changes)
