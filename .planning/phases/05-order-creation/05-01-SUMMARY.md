---
phase: "05"
plan: "01"
subsystem: "orders"
tags: ["voice-order", "n8n", "internal-api", "tdd", "idempotency", "shared-secret"]
dependency_graph:
  requires: ["AI_SERVER_SHARED_SECRET env var", "idempotency_keys table", "orders table", "order_items table", "order_events table", "outbox table"]
  provides: ["POST /v1/orders/voice endpoint"]
  affects: ["apps/api/src/routes/orders.ts", "apps/api/src/app.ts"]
tech_stack:
  added: []
  patterns: ["timing-safe shared-secret auth", "inline middleware chain for auth before idempotency", "TDD red-green"]
key_files:
  created: ["apps/api/tests/unit/orders-voice.test.ts"]
  modified: ["apps/api/src/routes/orders.ts", "apps/api/src/app.ts"]
decisions:
  - "sessionId set to 'voice' string (not undefined) to satisfy req.auth TypeScript type"
  - "Validation runs before idempotency middleware so req.auth (with userId) is available for idempotency hash"
  - "isValidSharedSecret defined as module-local function (not imported from livekit.ts) to avoid cross-module coupling"
metrics:
  duration: "~25 minutes"
  completed: "2026-03-17T00:51:32Z"
  tasks_completed: 1
  files_changed: 3
---

# Phase 5 Plan 01: Voice Order Endpoint Summary

**One-liner:** Internal `POST /v1/orders/voice` endpoint authenticated by `AI_SERVER_SHARED_SECRET` header, enabling n8n to create orders on behalf of buyers with full idempotency support.

## What Was Built

Added `voiceOrderRouter` with a single `POST /voice` route that:

1. Authenticates callers via `x-ai-server-secret` header using `crypto.timingSafeEqual` — no buyer JWT required
2. Validates body with `VoiceCreateOrderSchema` (includes `userId` field that normal orders derive from JWT)
3. Patches `req.auth` with the buyer userId before the idempotency middleware so the idempotency hash correctly scopes to that buyer
4. Runs the same full order creation transaction as `POST /` — lot validation, lot window checks, stock checks, price calculation, INSERT orders/order_items/order_events, outbox event
5. Returns `201 { data: { orderId, status: "pending_seller_approval", totalPrice } }`

The router is mounted at `/v1/orders` in `app.ts`, making the full path `POST /v1/orders/voice`.

## Files Changed

| File | Change |
|------|--------|
| `apps/api/tests/unit/orders-voice.test.ts` | New — 6 TDD tests |
| `apps/api/src/routes/orders.ts` | Added `isValidSharedSecret`, `VoiceCreateOrderSchema`, `voiceOrderRouter` export |
| `apps/api/src/app.ts` | Import `voiceOrderRouter`, mount at `/v1/orders` |

## Test Results

All 6 tests pass:

1. Missing `x-ai-server-secret` header → 401 UNAUTHORIZED
2. Wrong `x-ai-server-secret` value → 401 UNAUTHORIZED
3. Missing `Idempotency-Key` header (valid auth + body) → 400 IDEMPOTENCY_KEY_REQUIRED
4. Missing `userId` in body → 400 VALIDATION_ERROR
5. Valid request with mocked DB → 201 `{ orderId, status, totalPrice }`
6. Duplicate Idempotency-Key → 201 replay with `x-idempotent-replay: true`

Build: `npm run build:api` passes with no TypeScript errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod v4 UUID validation requires variant bit in 4th segment**
- **Found during:** Task 1 (test implementation)
- **Issue:** Test UUIDs like `"11111111-1111-1111-1111-111111111111"` fail Zod v4's stricter UUID regex which requires the 4th segment to start with `[89abAB]` (the RFC 4122 variant byte). The plan example used all-same-digit UUIDs which don't satisfy this constraint.
- **Fix:** Updated test UUIDs to use `8` as the first char of the 4th segment (e.g., `"11111111-1111-1111-8111-111111111111"`)
- **Files modified:** `apps/api/tests/unit/orders-voice.test.ts`
- **Commit:** fec2fe9

**2. [Rule 1 - Bug] TypeScript type error: sessionId cannot be undefined**
- **Found during:** Build verification
- **Issue:** Plan suggested `sessionId: undefined` for req.auth patch, but the Express type declaration requires `sessionId: string`
- **Fix:** Set `sessionId: "voice"` — a meaningful sentinel value indicating the request came via the voice/AI pipeline
- **Files modified:** `apps/api/src/routes/orders.ts`
- **Commit:** fec2fe9

## Self-Check: PASSED

- FOUND: `apps/api/tests/unit/orders-voice.test.ts`
- FOUND: `apps/api/src/routes/orders.ts` (modified)
- FOUND: `apps/api/src/app.ts` (modified)
- FOUND: commit fec2fe9
