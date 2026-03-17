---
phase: "05"
plan: "03"
subsystem: "orders"
tags: ["voice-order", "notify-cook", "outbox", "internal-api"]
dependency_graph:
  requires: ["05-01"]
  provides: ["cook-notification-endpoint"]
  affects: ["orders", "outbox_events"]
tech_stack:
  added: []
  patterns: ["x-ai-server-secret auth", "outbox event pattern", "transactional DB client"]
key_files:
  created: []
  modified:
    - "apps/api/src/routes/orders.ts"
    - "apps/api/tests/unit/orders-voice.test.ts"
decisions:
  - "Endpoint placed on voiceOrderRouter (not ordersRouter) to keep internal AI-server endpoints separated from buyer-JWT endpoints"
  - "UUID regex validation on :id param prevents invalid DB queries before pool.connect()"
  - "No order status restriction — cook can be notified regardless of current status; outbox consumer handles deduplication"
metrics:
  duration: "~5 minutes"
  completed: "2026-03-17"
  tasks_completed: 1
  files_changed: 2
---

# Phase 05 Plan 03: notify-cook Endpoint Summary

Added `POST /v1/orders/:id/notify-cook` to the `voiceOrderRouter` in `apps/api/src/routes/orders.ts`. The endpoint is protected by `x-ai-server-secret` (timing-safe compare via `isValidSharedSecret`) — no buyer JWT required. On success it enqueues a `cook_notification_sent` outbox event with `channel: "voice_order"` and returns `{ data: { notified: true, orderId, sellerId } }`.

## What Was Built

- **Endpoint:** `POST /v1/orders/:id/notify-cook` on `voiceOrderRouter`
- **Auth:** `x-ai-server-secret` shared secret (reuses existing `isValidSharedSecret` helper)
- **Validation:** UUID regex on `:id` param before DB touch
- **DB:** Single transaction — SELECT order, enqueue outbox event, COMMIT
- **Outbox event:** `eventType = "cook_notification_sent"`, `aggregateType = "order"`, payload includes `orderId`, `sellerId`, `buyerId`, `status`, `notifiedAt`, `channel`
- **Error paths:** 503 when env var missing, 401 bad secret, 400 invalid UUID, 404 order not found, 500 on DB error

## Test Results

All 10 tests in `tests/unit/orders-voice.test.ts` pass:

- 4 new tests for `POST /v1/orders/:id/notify-cook`:
  - 401 UNAUTHORIZED when `x-ai-server-secret` is missing
  - 404 ORDER_NOT_FOUND when order does not exist
  - 200 with `{ notified: true, orderId, sellerId }` on valid request
  - Outbox event enqueued with `eventType = "cook_notification_sent"` and `channel = "voice_order"`
- 6 pre-existing tests for `POST /v1/orders/voice` continue to pass

Build: `npm run build:api` exits clean (no TypeScript errors).

Full suite: 3 test files with pre-existing failures (`n8n-service`, `livekit-mobile-routes`, `lots-routes`) — unrelated to this task and present before these changes.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- [x] `apps/api/src/routes/orders.ts` modified with notify-cook handler
- [x] `apps/api/tests/unit/orders-voice.test.ts` updated with 4 new tests
- [x] Commit `26b37f0` exists
- [x] All 10 orders-voice tests pass
- [x] TypeScript build clean
