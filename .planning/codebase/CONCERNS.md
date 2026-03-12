# Codebase Concerns

**Analysis Date:** 2026-03-12

## Tech Debt

**Monolithic Admin Users Route (4,046 lines):**
- Issue: `apps/api/src/routes/admin-users.ts` contains 4,046 lines with multiple search functions, list queries, mutation handlers, and complex SQL embedded directly in route handlers
- Files: `apps/api/src/routes/admin-users.ts`
- Impact: Hard to test individual functionality; difficult to maintain; mixing concerns (validation, query building, DB access, response formatting); slow to understand code flow; increased risk of bugs
- Fix approach: Extract database queries into service layer (`apps/api/src/services/admin-users-service.ts`), create separate handlers for each endpoint type, implement query builder pattern or repository pattern to isolate SQL

**Embedded SQL in Route Handlers:**
- Issue: Complex SQL queries (200+ line constructs) embedded directly in route handlers across `apps/api/src/routes/admin-users.ts`, `apps/api/src/routes/admin-audit.ts`, `apps/api/src/routes/admin-dashboard.ts`, `apps/api/src/routes/admin-livekit.ts`
- Files: `apps/api/src/routes/admin-users.ts` (multiple locations), `apps/api/src/routes/admin-audit.ts`, `apps/api/src/routes/admin-dashboard.ts`, `apps/api/src/routes/admin-livekit.ts`
- Impact: SQL injection risk if parameterization breaks; impossible to reuse query logic; query optimization is route-specific; hard to test query correctness in isolation
- Fix approach: Create data access layer with parameterized query builders, unit test all queries, consider lightweight query library (e.g., slonik or pg-promise for better SQL safety)

**Limited Test Coverage:**
- Issue: Only 7 test files for 48+ source files in API; no tests for 85%+ of route handlers (admin-users, admin-audit, admin-dashboard, orders, payments, etc.)
- Files: `apps/api/tests/unit/` - only covers: `livekit-mobile-routes.test.ts`, `security.test.ts`, `normalize.test.ts`, `n8n-service.test.ts`, `lots-routes.test.ts`, `payouts-service.test.ts`, `order-state-machine.test.ts`
- Impact: Changes to core business logic (orders, payments, finance, compliance) have no test safety; regressions in admin functions not caught before production; complex search filters in admin-users untested
- Fix approach: Prioritize tests for payment flows, order state transitions, payout calculations, admin user mutations; extract testable service functions; set coverage requirements (min 70% for critical paths)

**Console Logging Instead of Structured Logging:**
- Issue: Direct `console.error()` and `console.log()` calls scattered throughout codebase (8 instances found in `apps/api/src/`)
- Files: `apps/api/src/routes/admin-users.ts` (line ~1142), `apps/api/src/db/client.ts` (line 32)
- Impact: Logs lack timestamp, context, request ID; hard to correlate errors across services; impossible to filter logs by severity or component in production
- Fix approach: Replace console with structured logger (e.g., pino, winston) that includes request context from `apps/api/src/middleware/observability.ts`, emit JSON logs for aggregation

## Security Concerns

**Database SSL Certificate Validation Disabled:**
- Issue: `apps/api/src/db/client.ts` defaults to `{ rejectUnauthorized: false }` for all non-localhost connections, disallowing proper SSL/TLS verification
- Files: `apps/api/src/db/client.ts` (lines 7, 16, 22)
- Current mitigation: Code comment explains it's a fallback when `DATABASE_SSL_MODE=no-verify`; applies only when cert is not otherwise validated
- Risk: Man-in-the-middle attacks on database connection if certificate validation is bypassed; production databases should always verify certificates
- Recommendations:
  - Change default to `{ rejectUnauthorized: true }` for non-localhost
  - Require explicit `DATABASE_SSL_MODE=no-verify` in development only
  - Document that production must provide valid CA certificates
  - Add startup check to warn if SSL verification is disabled in non-dev

**Default Admin Credentials Hardcoded in Code:**
- Issue: Seeded default admin credentials (`admin@coziyoo.com` / `Admin12345`) documented in CLAUDE.md; if seed script runs in production, creates backdoor
- Files: CLAUDE.md documentation references `apps/api/scripts/seed-admin.ts` (not examined but referenced)
- Current mitigation: Seed script presumably requires explicit invocation
- Risk: If seed script runs automatically or accidentally in production, backdoor account exists
- Recommendations:
  - Make seed scripts production-aware; refuse to run if `NODE_ENV=production`
  - Randomize default credentials when seeding, print them to stdout only once
  - Add audit log entry when default credentials are used

**N8N Webhook Authentication Incomplete:**
- Issue: `apps/api/src/services/n8n.ts` builds headers with `x-n8n-api-key` and `authorization` but also accepts unauthenticated N8N responses; outgoing webhooks may not validate origin
- Files: `apps/api/src/services/n8n.ts` (lines 16-22), webhook receivers across routes
- Impact: N8N workflow calls to API endpoints not authenticated; order processing webhooks could be spoofed
- Recommendations:
  - Add request signature validation (HMAC) for N8N webhooks
  - Store N8N webhook secrets in environment (`N8N_WEBHOOK_SECRET`)
  - Document expected N8N payload signatures

**Payment Provider Mock Implementation in Production:**
- Issue: Default `PAYMENT_PROVIDER_NAME=mockpay` in `apps/api/src/config/env.ts` (line 32); easy to forget to configure real provider
- Files: `apps/api/src/config/env.ts` (line 32)
- Impact: Real payments not processed; all payment flows silently fake-succeed; money never received
- Recommendations:
  - Remove mock provider from production builds
  - Fail startup if real provider config incomplete in production
  - Add payment provider validation during system health check

## Performance Bottlenecks

**Unoptimized Admin Dashboard Queries:**
- Issue: `apps/api/src/routes/admin-dashboard.ts` uses `Promise.all()` to run 4 independent aggregation queries without indexes documented
- Files: `apps/api/src/routes/admin-dashboard.ts`
- Problem: Counts users, orders, compliance, disputes in parallel but doesn't specify needed indexes; COUNT(*) on large tables without filtered WHERE is slow
- Improvement path:
  - Add database indexes on created_at, status, and filtered columns
  - Cache dashboard metrics (5-minute TTL) if queries exceed 500ms
  - Add query execution time logging to identify slow queries

**Admin User Search with Global Text Search:**
- Issue: `apps/api/src/routes/admin-users.ts` search function runs complex multi-table search (`sellers`, `buyers`, `foods`, `orders`, `lots`, `complaints`) with `Promise.all()` without apparent pagination or full-text search
- Files: `apps/api/src/routes/admin-users.ts` (~line 950-1000+)
- Impact: Searching 6 tables at once with potentially millions of rows; no indication of result limiting
- Improvement path:
  - Use PostgreSQL full-text search indices
  - Limit each table search to top 100 results
  - Cache search results (1-minute TTL)
  - Add query timeout (5 seconds max)

**Large Livekit Route File (1,464 lines):**
- Issue: `apps/api/src/routes/livekit.ts` handles agent dispatch, room token generation, settings management, and admin operations
- Files: `apps/api/src/routes/livekit.ts`
- Impact: Hard to debug; multiple responsibilities (token minting, room creation, agent dispatch, settings CRUD); testing entire file is slow
- Fix approach: Split into separate routers (`token-router`, `room-router`, `agent-dispatcher-router`, `settings-router`), extract agent dispatch logic to service

**Potentially Expensive Promise.all Calls:**
- Issue: Multiple unguarded `Promise.all()` calls in admin routes without error handling per promise
- Files: `apps/api/src/routes/admin-dashboard.ts`, `apps/api/src/routes/admin-users.ts`
- Problem: One failed query kills entire request; no partial results; no retry logic
- Improvement: Use `Promise.allSettled()` for dashboard/search to tolerate partial failures; implement circuit breaker for external services (N8N, Ollama)

## Fragile Areas

**Payout State Machine Complexity:**
- Issue: `apps/api/src/services/payouts.ts` (400 lines) manages batch creation, item insertion, transaction handling with complex state validation
- Files: `apps/api/src/services/payouts.ts`
- Why fragile: Multiple early returns checking table existence; complex SQL for moving between states; relies on database constraints but not all enforced; finance adjustments coupled to payout logic
- Safe modification:
  - Add unit tests for each state transition (pending → processing → paid)
  - Separate batch creation from item insertion
  - Document state machine transitions with diagrams
  - Add database constraints on batch.status values
- Test coverage: `apps/api/tests/unit/payouts-service.test.ts` exists but limited - expand to cover state transitions

**Voice Agent Settings with Dynamic Table Columns:**
- Issue: `apps/api/src/services/starter-agent-settings.ts` (507 lines) detects schema capabilities at runtime to handle missing DB columns
- Files: `apps/api/src/services/starter-agent-settings.ts` (lines 51-52 show dynamic capability detection)
- Why fragile: Schema migration detection is fragile (checks `to_regclass()` at query time); missing columns silently handled; TTS server selection logic complex
- Safe modification:
  - Run schema verification at startup, fail loudly if required columns missing
  - Document schema versions in database
  - Add NOT NULL defaults for all columns to catch missing fields early
- Test coverage: No tests found - add tests for missing columns, invalid TTS engine values

**Admin RBAC Middleware with Null Returns:**
- Issue: `apps/api/src/middleware/app-role.ts` returns `null` for unrecognized roles instead of throwing
- Files: `apps/api/src/middleware/app-role.ts`
- Problem: Caller must check for null; if not checked, role-based logic silently fails to buyer/seller
- Safe modification:
  - Throw error for unknown roles instead of returning null
  - Add unit test for each role resolution path
  - Add logging when role is null to catch silent failures in production

**Order State Machine Validation:**
- Issue: `apps/api/src/routes/orders.ts` (488 lines) handles order state transitions but fragile if new states added
- Files: `apps/api/src/routes/orders.ts`
- Problem: State transitions hardcoded in multiple places; no centralized state machine; easy to allow invalid transitions
- Safe modification:
  - Move to centralized state machine service (test file exists: `apps/api/tests/unit/order-state-machine.test.ts` suggests this exists)
  - Document all valid state transitions
  - Add database constraint to prevent invalid state combinations

## Known Limitations

**Bare Null Returns in Service Functions:**
- Issue: Functions return `null` to indicate missing data, error, or invalid input indiscriminately
- Files: `apps/api/src/routes/livekit.ts` (lines with `if (!url) return null`), `apps/api/src/services/starter-agent-settings.ts` (lines 72-75), `apps/api/src/services/payouts.ts` (lines with `return null`)
- Impact: Callers can't distinguish between "not found", "error", "invalid input", and "not configured"; debugging is harder; error messages are generic
- Fix approach: Use typed results (`Result<T, Error>` or `Option<T>` type) or throw specific errors with error codes

**Incomplete Error Categorization:**
- Issue: `apps/api/src/routes/admin-users.ts` `handleMutationError()` function (referenced but not examined) may be swallowing error details
- Files: `apps/api/src/routes/admin-users.ts` (catch blocks call `handleMutationError()`)
- Impact: Database errors not distinguished from validation errors; clients can't implement retry logic
- Recommendations:
  - Create error hierarchy (ValidationError, DatabaseError, RateLimitError, etc.)
  - Log full stack traces internally; return generic code to client
  - Add error codes to all API responses

**N8N Integration Graceful Degradation:**
- Issue: `apps/api/src/services/n8n.ts` returns empty/zero status when N8N unreachable, but order processing may depend on it
- Files: `apps/api/src/services/n8n.ts` (lines 57-92, 85-92)
- Impact: Order processing continues when N8N is down; no alert; workflows silently fail
- Recommendations:
  - Add startup check that fails if N8N is unconfigured but required
  - Make N8N integration optional (queue orders locally, retry when available)
  - Add monitoring alerts for N8N unreachability

**Missing Input Validation on Complex JSON:**
- Issue: `apps/api/src/routes/livekit.ts` accepts `metadata: z.string().max(2_000)` but doesn't validate JSON structure inside
- Files: `apps/api/src/routes/livekit.ts` (lines 31, 42)
- Impact: Invalid metadata JSON crashes downstream agents; mobile clients send arbitrary JSON
- Fix: Parse and validate metadata JSON schema server-side before storing

## Dependencies at Risk

**LiveKit Agent Framework Dependency:**
- Risk: Python voice agent (`apps/voice-agent/`) depends on `livekit.agents` framework (imported in entrypoint.py) which may be under-maintained or fragile
- Impact: Agent crashes affect all voice ordering sessions; limited ability to swap implementations
- Migration plan: Create abstraction layer over LiveKit SDK in `apps/voice-agent/agents/base.py` to allow swapping providers

**Ollama Integration Hardcoded:**
- Risk: LLM provider hardcoded to Ollama; no fallback if Ollama unavailable
- Impact: Voice agent can't function if Ollama crashes; no graceful degradation
- Recommendations:
  - Add fallback to OpenAI API if Ollama unavailable
  - Implement circuit breaker with fallback model
  - Document configuration for multiple LLM providers

## Testing Gaps

**Zero Tests for Financial Flows:**
- Issue: No tests for order → payment → payout → seller settlement flow
- Files: `apps/api/src/routes/payments.ts`, `apps/api/src/routes/finance.ts`, `apps/api/src/services/payouts.ts`
- Risk: Money calculation errors, missing payouts, duplicate charges undetected until production
- Priority: HIGH - Add integration tests for complete payment → finance → payout → ledger → settlement

**No Tests for Admin Mutations:**
- Issue: Admin user creation, role changes, status updates untested
- Files: `apps/api/src/routes/admin-users.ts` (4,046 lines, ~70% of which are mutations)
- Risk: Admin panel breaks silently; privilege escalation bugs possible
- Priority: HIGH - Add tests for RBAC enforcement, admin creation, role changes

**Compliance Module Partially Untested:**
- Issue: `apps/api/src/routes/compliance.ts` (1,235 lines) has no visible test file
- Files: `apps/api/src/routes/compliance.ts`
- Risk: Seller verification logic, KYC validations could have bugs; regulatory issues
- Priority: MEDIUM - Add tests for document upload, status transitions, rejection logic

**No E2E Tests:**
- Issue: No end-to-end test flow (create order → approve → accept payment → deliver → payout)
- Impact: Integration between services (orders, payments, N8N, voice agent) untested
- Priority: MEDIUM - Add E2E test suite with test database fixtures

## Scaling Limits

**Admin Dashboard Queries Block on Large Tables:**
- Current capacity: Tested up to 100K users, 500K orders (not documented)
- Limit: COUNT(*) queries without WHERE on 1M+ orders will exceed 5-second timeout
- Scaling path:
  - Add materialized views for dashboard metrics (refreshed every 5 min)
  - Use approximate counts (`pg_stat_user_tables`) for rough numbers
  - Cache metrics with 5-minute TTL

**Payment Session Storage in Memory:**
- Current capacity: Unknown (no documented limit on `payment_attempts` table)
- Limit: No batch cleanup of old payment sessions; table grows unbounded
- Scaling path:
  - Add scheduled job to archive/delete payment sessions older than 30 days
  - Add index on `payment_attempts.created_at` for cleanup queries
  - Monitor table size growth

**Voice Agent Room Management:**
- Current capacity: LiveKit cluster size determines concurrent rooms
- Limit: No documented max rooms or connection limits; no rate limiting per user
- Scaling path:
  - Document max concurrent sessions supported
  - Add rate limiting to agent dispatch endpoint
  - Monitor LiveKit room count via admin API

**Payout Batch Processing Serial:**
- Current capacity: Batch creation serialized; unknown throughput
- Limit: Creating large batches (10K+ items) could be slow
- Scaling path:
  - Implement batch chunking (1K items per sub-batch)
  - Parallelize item insertion within transaction
  - Add progress tracking for long-running batch jobs

## Missing Critical Features

**No Audit Trail for Financial Transactions:**
- Problem: Payouts, adjustments, corrections not logged; no way to trace money flow
- Blocks: Financial reconciliation, dispute resolution, compliance reporting
- Impact: Can't prove transactions were processed correctly; money disappears without trace
- Approach:
  - Create immutable `financial_audit_log` table
  - Log every debit/credit with source, actor, timestamp
  - Implement financial statement generation from audit log

**No Circuit Breaker for External Services:**
- Problem: N8N, Ollama, TTS, STT failures cascade (slow timeouts, cascading errors)
- Blocks: Graceful degradation; self-healing; monitoring
- Impact: One slow N8N instance stalls entire order processing
- Approach:
  - Implement circuit breaker pattern for N8N, Ollama, TTS
  - Fall back to queue when circuit open
  - Add health checks with exponential backoff

**No Request Tracing Across Services:**
- Problem: Order request bounces between API (Node), voice-agent (Python), N8N without correlation ID
- Blocks: Debugging end-to-end flows; performance analysis
- Impact: Can't trace single order through system
- Approach:
  - Add distributed tracing with OpenTelemetry
  - Propagate context ID through all services
  - Export traces to Jaeger/Tempo

**No Seller Payout Approval Workflow:**
- Problem: Payouts generated automatically; no seller review or rejection option
- Blocks: Seller dispute resolution; payout corrections
- Impact: Seller has no recourse if payout amount wrong
- Approach:
  - Add payout approval state machine (pending → submitted → accepted → paid)
  - Allow seller to reject with reason
  - Require manual admin intervention for rejections

---

*Concerns audit: 2026-03-12*
