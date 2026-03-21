# Codebase Concerns

**Analysis Date:** 2026-03-21

## Tech Debt

**Duplicate Migration Numbers:**
- Issue: Two migration files share the same version number `0006`:
  - `0006_seller_notes_and_tags.sql` — seller notes/tags tables
  - `0006_user_memory_tables.sql` — session and long-term memory tables
- Files: `apps/api/src/db/migrations/0006_*.sql`
- Impact: Migration runner will execute only one of these files; the other schema may be missing in production. This creates a schism between local dev and production databases.
- Fix approach: Rename `0006_user_memory_tables.sql` to `0014_user_memory_tables.sql` (next sequential after `0013`). Verify both tables exist on all environments via `SELECT to_regclass()` before deploying.

**Stubbed Voice Agent Sales Tools:**
- Issue: `search_products()` and `create_quote()` functions are stubs that return hardcoded responses
- Files: `apps/voice-agent/src/voice_agent/tools/sales_tools.py:14,19`
- Impact: Voice agent cannot perform actual product searches or quote creation; conversations will fail when users attempt real transactions
- Fix approach: Implement actual REST API integration to `/v1/foods` (search) and payment/ordering endpoints. Add error handling for API timeouts and rate limits.

**Admin Users Route Complexity:**
- Issue: Single route file (`admin-users.ts`) contains 4,994 lines of code with 5 major responsibilities:
  - User CRUD operations
  - Complaint management
  - Buyer/seller notes and tags
  - Global search functionality
  - Compliance/risk assessment
- Files: `apps/api/src/routes/admin-users.ts`
- Impact: Difficult to test, maintain, and reason about. Single change risks multiple features. Circular updates between buyer notes, seller notes, complaint resolution, and user status.
- Fix approach: Split into `admin-users-core.ts`, `admin-complaints.ts`, `admin-user-notes.ts`, `admin-user-search.ts`. Share reusable helpers in `services/user-helpers.ts`.

**HomeScreen Component Bloat:**
- Issue: Mobile home screen component is 3,498 lines with 11 major state machines:
  - Tab navigation
  - Food list fetching and caching
  - Cart state
  - Profile state
  - Search state
  - Voice session management
  - Payment webview
  - Marquee animations
  - Settings modals
- Files: `apps/mobile/src/screens/HomeScreen.tsx`
- Impact: Component is difficult to test; any UI change risks breaking multiple features. Animation state is tightly coupled to data fetching. Hard to reason about re-render triggers.
- Fix approach: Extract cart, profile, settings, and voice session logic into custom hooks. Move animations to separate context. Break into focused sub-components: `<HomeTabContent>`, `<FoodCardList>`, `<SloganMarquee>`, `<CartBadge>`.

**Deleted VoiceSessionScreen Removal:**
- Issue: `apps/mobile/src/screens/VoiceSessionScreen.tsx` was deleted but voice session logic still exists and is imported in HomeScreen
- Files: `apps/mobile/src/voice/`, referenced in `apps/mobile/src/screens/HomeScreen.tsx:43`
- Impact: Voice session initialization and lifecycle is now embedded in HomeScreen; breaks single-responsibility principle and makes voice features hard to test independently.
- Fix approach: Restore or recreate `VoiceSessionScreen.tsx` as a dedicated modal/overlay. Move voice state machine to `apps/mobile/src/voice/useVoiceSession.ts` hook.

**Unstructured Payment Webhook Handling:**
- Issue: `/v1/payments/webhook` accepts unauthenticated requests from payment provider with HMAC verification only
- Files: `apps/api/src/routes/payments.ts:160–299`
- Impact: If `PAYMENT_WEBHOOK_SECRET` is leaked, attacker can confirm arbitrary payment attempts and mark unpaid orders as paid. No request origin validation.
- Fix approach: Add IP whitelist for payment provider; log all webhook attempts with source IP; add rate limiting by sessionId; implement webhook signature versioning; require idempotency key.

**Return Endpoint Lacks Authentication:**
- Issue: `/v1/payments/return` is a GET endpoint with no authentication that updates payment status
- Files: `apps/api/src/routes/payments.ts:132–158`
- Impact: Any user knowing a payment sessionId can manipulate payment status by visiting the return URL. No authorization check that requester is the order buyer.
- Fix approach: Validate that requester is order buyer via JWT; implement return signature validation; redirect to app:// deep link instead of direct status update.

## Security Considerations

**Missing Test Coverage on Core Flows:**
- Risk: Zero unit tests in `apps/api/src/` for payment flow, authentication, or order state machines
- Files: No `*.test.ts` files in `apps/api/src/`
- Current mitigation: Manual testing and production monitoring
- Recommendations: Implement Vitest test suite for:
  - Payment state transitions (initiated → confirmed → failed)
  - Auth token refresh and expiry
  - Order validation before payment start
  - Permission checks on admin routes
  - SQL injection resilience (parameterized queries)

**Exposed Payment Metadata:**
- Risk: `/v1/payments/mock-checkout` endpoint displays full order details (buyer name, total amount) without authentication
- Files: `apps/api/src/routes/payments.ts:305–330`
- Current mitigation: sessionId is opaque UUID
- Recommendations: Add rate limiting per sessionId; log access attempts; require User-Agent validation; gate development endpoint behind feature flag.

**Database Connection Pool Error Handling:**
- Risk: Idle connection errors logged to console with no alerting mechanism
- Files: `apps/api/src/db/client.ts:32`
- Current mitigation: Console logs to stdout (available in systemd journal)
- Recommendations: Implement error counter and alert if error rate > threshold; implement automatic reconnection backoff.

**JWT Audience Mismatch Not Validated:**
- Risk: Two JWT realms (`app` and `admin`) use different secrets but no validation that app tokens don't access admin endpoints
- Files: `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/admin-auth.ts`
- Current mitigation: Routes check `requireAuth("admin")` middleware
- Recommendations: Add explicit `aud` (audience) claim validation in JWT decode; enforce audience at middleware layer; reject tokens missing audience claim.

## Performance Bottlenecks

**N+1 Query in Admin User List:**
- Problem: Complaint stats, order stats, and review stats are subqueries in main SELECT but run once per user row
- Files: `apps/api/src/routes/admin-users.ts:749–804` (list endpoint), specific queries at lines 2701–2705
- Cause: Separate COUNT(*) subqueries for each user's complaints, orders, reviews instead of single JOIN with aggregation
- Improvement path:
  1. Use window functions to compute `row_number()` OVER (PARTITION BY...) instead of subqueries
  2. Precompute materialized view of user stats (complaints, orders, reviews) refreshed hourly
  3. Add database indexes on (user_id, status, created_at) for complaint and order tables
  4. Current pagination is safe (LIMIT/OFFSET with ordering) but slow; consider keyset pagination after optimization

**Missing Database Indexes:**
- Problem: Large result sets sorted by `latestComplaintCreatedAt`, `monthlyOrderCountCurrent` without index support
- Files: `apps/api/src/routes/admin-users.ts:13–31` (sort fields), database queries
- Cause: Computed fields from JOINs/CTEs not directly indexable; sorting triggers full table scan
- Improvement path: Create functional index on complaint date/count; add partial index for `status = 'open' AND user_type IN ('buyer', 'seller')`

**Marquee Animation Re-renders:**
- Problem: HomeScreen marquee animation may trigger unnecessary re-renders of entire food list
- Files: `apps/mobile/src/screens/HomeScreen.tsx:100–200` (estimated, marquee animation logic)
- Cause: Animated.Value updates at 60fps may propagate through component tree if not isolated to `<Animated.View>`
- Improvement path: Extract marquee to separate `useMemo()`-wrapped component; use `React.memo()` for `<FoodCardList>` to prevent re-renders

**Voice Agent Model Loading:**
- Problem: Turn detector model loaded on every agent job initialization
- Files: `apps/voice-agent/src/voice_agent/entrypoint.py:87–105` (model loading logic)
- Cause: `_load_turn_detector()` may download model from disk/network on each call
- Improvement path: Cache model instance at module level; implement singleton pattern; log load time; measure cold start vs warm start

## Fragile Areas

**Order State Machine:**
- Files: `apps/api/src/routes/orders.ts`, `apps/api/src/routes/payments.ts`, `apps/api/src/services/payouts.ts`
- Why fragile: Order status is modified in 5+ places (order creation, seller approval, payment start, payment confirmation, fulfillment). No centralized state transition validation. If payment webhook arrives before buyer's refresh, order may be `paid` but client shows `awaiting_payment`.
- Safe modification: Add explicit state transition function `validateOrderTransition(fromStatus, toStatus)` that enumerates all valid paths. Use database trigger to prevent invalid direct updates. Add event sourcing via `order_events` table.
- Test coverage: Currently ~0%; need tests for all transition paths, concurrent updates, and webhook idempotency.

**Complaint Resolution with Actor Role Complexity:**
- Files: `apps/api/src/routes/admin-users.ts:2000–2100` (estimated, complaint creation logic)
- Why fragile: Complaint can be filed by buyer OR seller (new `complainantType` field in 0010 migration). Legacy complaints have `complainantBuyerId` but new ones use `complainantUserId + complainantType`. SQL queries must handle both with `COALESCE(complainant_user_id, complainant_buyer_id)` pattern. One missing coalesce breaks filtering.
- Safe modification: Add database view `complaint_complainant_view` that normalizes both legacy and new schemas. Use view in all queries instead of inline coalesce. Add NOT NULL constraint on new complaints.
- Test coverage: Gaps in legacy complaint queries and mixed-actor complaint filtering.

**Payment Webhook Idempotency:**
- Files: `apps/api/src/routes/payments.ts:160–299` (webhook handler)
- Why fragile: Webhook is idempotent via `(session_id, status, provider_reference_id)` unique constraint but if exact duplicate arrives, both UPDATE and enqueueOutboxEvent may run twice, creating duplicate order_events and outbox messages. Status field is case-sensitive (`'confirmed'` vs `'CONFIRMED'`).
- Safe modification: Add explicit idempotency check: `IF payment.status = 'confirmed' THEN return 200 immediately`. Ensure outbox deduplicates by (aggregate_id, event_type).
- Test coverage: No webhook retry/duplicate testing; need to simulate provider sending webhook 2x.

**Seller Notes/Tags Race Condition:**
- Files: `apps/api/src/routes/admin-users.ts` (seller note/tag endpoints)
- Why fragile: Seller can update their own profile while admin is adding notes. If both happen simultaneously, note INSERT may reference outdated seller_id or fail if seller deletes account. Foreign key constraint RESTRICT prevents deletion but doesn't prevent concurrent updates.
- Safe modification: Add `seller_id` + `created_at` unique constraint; use seller_id + admin_id as compound key to prevent duplicate notes. Add transaction isolation level SERIALIZABLE for note operations.
- Test coverage: No concurrency testing.

## Scaling Limits

**PostgreSQL Connection Pool Exhaustion:**
- Current capacity: Default pool size unknown (check `pg` package defaults; typically 10 connections)
- Limit: If peak load exceeds pool size, requests queue and timeout. Admin operations on `/admin/users` list (multiple COUNT queries) consume 1–2 connections each for page load.
- Scaling path: Set `PGMAXCONNECTIONS` env var explicitly; implement connection pool monitoring; add metrics for pool utilization; switch to pgbouncer in transaction mode for multiplexing; increase pool size to 20–30 for production.

**Memory Usage in HomeScreen:**
- Current capacity: Mobile app memory footprint scales with food list size (currently ~1000 items in state)
- Limit: Animated values, FlatList, and marquee state may cause OOM on mid-range Android devices (< 2GB RAM)
- Scaling path: Implement virtual scrolling for food list; limit marquee animation to visible items only; clear cache on tab blur; implement pagination with `onEndReached` callback.

**Admin User Search Complexity:**
- Current capacity: Smart filters (e.g., `same_ip_multi_account`) run CTEs that scan entire `user_login_locations` table
- Limit: With 100k users and 1M login records, search queries may timeout after 30s
- Scaling path: Precompute smart filter results in background job; store results in `user_risk_flags` table; expire daily; add caching layer (Redis) for search results.

## Dependencies at Risk

**Express v5.2.1 (Pre-Release):**
- Risk: Version 5.x is still pre-release (not 5.0 stable). API changes or security fixes may not backport to 4.x. Community packages may not support 5.x.
- Impact: If Express publishes breaking change, must update all route files. Middleware compatibility unknown.
- Migration plan: Upgrade to Express 5.0 stable once released (target Q3 2026). Add pre-release version warning to deployment runbooks. Test all routes after upgrade.

**Argon2 v0.44.0 (Outdated):**
- Risk: Package is not actively maintained; newer versions may have security improvements
- Impact: If vulnerability discovered in Argon2 hashing, cannot patch without major update
- Migration plan: Check `npm audit` for known vulnerabilities; upgrade to latest when available. Implement password re-hashing on login (transparent to user) to migrate old hashes.

**Zod v4.3.6 (Pre-Release):**
- Risk: Zod 4.x is beta; stable 3.x is older. Schema syntax may change.
- Impact: Breaking changes to validation logic if Zod 5.0 released
- Migration plan: Pin Zod to 3.x stable or upgrade to 4.0 stable once released. Test all schemas after upgrade.

## Missing Critical Features

**No Logging Infrastructure:**
- Problem: Errors logged only to console.error(); no structured logs, no log aggregation
- Blocks:
  - Error monitoring and alerting
  - Performance debugging in production
  - Audit trail for compliance
- Fix: Implement `winston` or `pino` logger; send logs to file or external service (ELK, DataDog); add request ID to all logs; log payment transitions with full audit context.

**No Rate Limiting Except Payment Start:**
- Problem: Most endpoints lack rate limiting; only `POST /v1/payments/start` has abuse protection middleware
- Blocks:
  - Protection against bot/scraper attacks
  - Brute force protection on login
  - Denial of service mitigation
- Fix: Implement rate limiter on all auth endpoints (login, register, forgot-password); add sliding window limiter; use IP + user_id as key; configurable per-endpoint limits.

**No Database Backup Automation:**
- Problem: No backup strategy documented or implemented at application level
- Blocks:
  - Disaster recovery if database corrupted
  - Point-in-time recovery if data deleted
- Fix: Implement daily encrypted backups to S3; test restore procedure weekly; document RTO/RPO targets; add backup verification job.

**No Secrets Rotation:**
- Problem: `PAYMENT_WEBHOOK_SECRET`, `APP_JWT_SECRET`, `ADMIN_JWT_SECRET` never rotated
- Blocks:
  - Limiting blast radius if secret leaked
  - Compliance with security baselines
- Fix: Implement versioned secrets with dual-write period (old + new secret both accepted); add rotation schedule (quarterly minimum); document rotation procedure.

## Test Coverage Gaps

**Payment Flow Untested:**
- What's not tested:
  - Order state transitions in payment start
  - Webhook signature validation with correct/wrong HMAC
  - Idempotency of webhook processing
  - Concurrent payment attempts on same order
  - Payment state with invalid orderIds
- Files: `apps/api/src/routes/payments.ts` (entire file, 612 lines, zero tests)
- Risk: Undetected payment processing bugs could leak money or crash orders. Webhook signature bypass could allow fraudulent payments.
- Priority: **High** — payment is critical path to revenue

**Authentication Untested:**
- What's not tested:
  - JWT expiry and refresh logic
  - Two-realm separation (app vs admin tokens)
  - Permission enforcement (buyer vs seller vs admin)
  - CORS header validation
  - Concurrent login/logout
- Files: `apps/api/src/routes/auth.ts` (829 lines), `apps/api/src/routes/admin-auth.ts` (no test coverage)
- Risk: Auth bypass, privilege escalation, token replay attacks
- Priority: **High** — foundational to all endpoints

**Order State Machine Untested:**
- What's not tested:
  - Valid state transitions (all paths in state diagram)
  - Invalid transitions (e.g., paid → pending)
  - Concurrent order updates
  - Order validation (inventory, seller approval)
  - Allergen handling
- Files: `apps/api/src/routes/orders.ts` (760 lines)
- Risk: Orders silently fail or transition to invalid states. Inventory oversold.
- Priority: **High** — core business logic

**Admin Routes Untested:**
- What's not tested:
  - Complaint creation and resolution
  - Buyer/seller notes CRUD
  - Smart filters (daily_buyer, suspicious_login, etc.)
  - Global search functionality
  - User suspension/reactivation
- Files: `apps/api/src/routes/admin-users.ts` (4,994 lines)
- Risk: Impossible to safely refactor or optimize this file. Bugs in admin operations go undetected.
- Priority: **Medium** — operational but not revenue-blocking

**Voice Agent Untested:**
- What's not tested:
  - Agent greeting flow
  - Sales tools (search_products, create_quote) integration
  - Turn detection and VAD (voice activity detection)
  - LLM prompt injection resistance
  - Session timeout handling
- Files: `apps/voice-agent/src/voice_agent/entrypoint.py` (1,194 lines)
- Risk: Voice sessions may hang, crash, or become unresponsive to user input
- Priority: **Medium** — feature in beta phase

---

*Concerns audit: 2026-03-21*
