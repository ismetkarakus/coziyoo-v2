# API Server v2 Rewrite Plan

## 0) Source of Truth

This rewrite is based on:
- `/Users/drascom/Work Folder/coziyoo/new-plan.md`

`new-plan.md` is authoritative for domain rules, API contract (`/v1`), compliance workflow, payment model, and commission logic.

---

## 1) Goals

1. Build a new backend from scratch (no dependency on existing API implementation).
2. Implement a versioned `/v1` API contract only.
3. Enforce single auth authority (backend JWT + refresh sessions).
4. Support external payment redirect/callback confirmation flow.
5. Implement operational compliance workflow (seller + admin review).
6. Implement seller finance with admin-configurable commission snapshots.

---

## 2) Non-Goals

1. Reusing old wallet system or wallet endpoints.
2. Supporting unversioned API paths.
3. Keeping legacy mock fallback flows.

---

## 3) Architecture Decisions (Locked)

1. Runtime: Node.js + Express + TypeScript.
2. DB: PostgreSQL as implementation target (Mongo compatibility can be documented, not implemented now).
3. Auth: Backend-issued JWT access tokens + rotating refresh tokens.
4. Management auth separation:
- `users` for app users (`buyer|seller|both`)
- `admin_users` for management users (`admin|super_admin`)
5. API prefix: `/v1/*`.
6. Payment: external provider hosted checkout; server-side callback confirmation required.

---

## 4) Workstreams

## WS-A: Platform Foundation

### Scope
1. New repository/folder structure for API v2.
2. Environment config and validation.
3. Initial database schema bootstrap (greenfield).
4. Common middleware (logging, error handling, validation, auth guards).

### Deliverables
1. `src/app.ts`, `src/server.ts`
2. `src/config/*` (env schema)
3. `src/middleware/*`
4. Initial schema bootstrap scripts for greenfield database setup.

### Acceptance Criteria
1. Server boots in local + test environments.
2. Health endpoint returns build/version metadata.
3. Initial schema bootstrap runs idempotently in empty environments.

---

## WS-B: Identity & Authorization

### Scope
1. App auth endpoints:
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`
- `GET /v1/auth/display-name/check?value=...`
2. Admin auth endpoints:
- `POST /v1/admin/auth/login`
- `POST /v1/admin/auth/refresh`
- `POST /v1/admin/auth/logout`
- `GET /v1/admin/auth/me`
3. Session tables:
- `auth_sessions`
- `admin_auth_sessions`
4. Audit tables:
- `auth_audit`
- `admin_auth_audit`
5. Display name uniqueness enforcement:
- global unique display name for app users
- normalization-based uniqueness (`display_name_normalized`)
- similarity/availability check endpoint for live typing UX

### Deliverables
1. JWT token service.
2. Refresh token rotation and revocation.
3. Route-level policy matrix for app/admin roles.

### Acceptance Criteria
1. Passwords hashed (Argon2id/bcrypt), never plaintext.
2. Refresh tokens stored hashed.
3. App tokens cannot access admin routes, admin tokens cannot access app-private routes.
4. `display_name_normalized` uniqueness is enforced at DB level.
5. Registration/profile update rejects non-unique display names with stable validation error.
6. Display-name check endpoint supports debounced UI availability checks and returns similarity suggestions.

---

## WS-C: Core Marketplace APIs

### Scope
1. Categories/Foods/Orders/Chats/Messages/Reviews/Favorites/Addresses/Media.
2. Strict `/v1` contracts and validation.
3. Pagination standards (offset/cursor as defined in `new-plan.md`).

### Deliverables
1. Endpoint controllers + services.
2. Shared response envelope (`data` + `pagination` where applicable).
3. Validation schemas and error code mapping.

### Acceptance Criteria
1. No unversioned routes.
2. Whitelisted sort fields only.
3. Stable pagination behavior under concurrent writes.

---

## WS-D: Payments (External Provider)

### Scope
1. Endpoints:
- `POST /v1/payments/start`
- `GET /v1/payments/return`
- `POST /v1/payments/webhook`
- `GET /v1/payments/:orderId/status`
2. Payment attempt tracking (`payment_attempts`).
3. Server-side callback verification and signature checks.
4. Idempotent payment/session handling.
5. Chargeback intake and dispute case lifecycle from provider callbacks.

### Deliverables
1. Provider adapter interface.
2. Callback verifier service.
3. Order transition guards (`awaiting_payment -> paid`).
4. Chargeback/dispute mapper (`provider payload -> payment_dispute_cases`).

### Acceptance Criteria
1. Return URL query alone never marks payment as paid.
2. Duplicate webhooks do not duplicate state transitions.
3. Failed verification leaves order in non-paid state.
4. Chargeback callbacks always open/update immutable dispute case history.

---

## WS-E: Compliance Workflow (Operational)

### Scope
1. Seller compliance lifecycle:
- `not_started -> in_progress -> submitted -> under_review -> approved|rejected -> suspended`
2. Country rules:
- TR baseline required + optional warnings
- UK all required checks verified before listing activation
3. Endpoints:
- seller compliance profile/docs/submit
- admin compliance queue/review actions
4. Allergen disclosure process records:
- persist evidence for `pre_order` disclosure and `handover` disclosure per order
5. Retention policy:
- `record_retention_policy = 2 years` (`730 days`) for compliance/payment/traceability/allergen records

### Deliverables
1. Tables:
- `seller_compliance_profiles`
- `seller_compliance_documents`
- `seller_compliance_checks`
- `seller_compliance_events`
- `allergen_disclosure_records`
2. Enforcement middleware for seller-sensitive endpoints.

### Acceptance Criteria
1. Compliance enforced server-side for listing creation/activation.
2. Review actions are auditable.
3. Rejection reasons are persisted and exposed to seller.
4. `completed` transition is blocked if required allergen disclosure records are missing.
5. Retention/lifecycle jobs respect `730-day` minimum retention and legal hold flags.

---

## WS-F: Seller Finance & Commission

### Scope
1. Commission settings admin-managed, versioned.
2. Finalized order finance snapshot on completion.
3. Immutable historical records.
4. Refund/chargeback responsibility workflow with liability allocation.
5. Reconciliation report generation for seller/admin.

### Deliverables
1. Tables:
- `commission_settings`
- `order_finance`
- `finance_adjustments`
- `payment_dispute_cases`
- `finance_reconciliation_reports`
- `reconciliation_report_items` (or deterministic query snapshot)
2. Endpoints:
- `GET /v1/admin/commission-settings`
- `POST /v1/admin/commission-settings`
- `GET /v1/sellers/:sellerId/finance/summary`
- `GET /v1/sellers/:sellerId/finance/orders`
- `POST /v1/orders/:id/refund-request`
- `GET /v1/orders/:id/disputes`
- `GET /v1/admin/disputes`
- `POST /v1/admin/disputes/:id/resolve`
- `POST /v1/sellers/:sellerId/finance/reports`
- `GET /v1/sellers/:sellerId/finance/reports`
- `POST /v1/admin/finance/reports`
- `GET /v1/admin/finance/reports`

### Acceptance Criteria
1. Commission change affects only future finalized orders.
2. `order_finance` is idempotent per `order_id`.
3. Refunds use adjustments; no mutation of original finalized finance rows.
4. Every dispute case has explicit liability party (`seller|platform|provider|shared`) and audit trail.
5. Reconciliation report totals match `order_finance + finance_adjustments` for the selected period.

---

## WS-G: Reliability, Security, Operations

### Scope
1. Idempotency layer for write endpoints.
2. Outbox + retry for asynchronous workflows.
3. Observability + SLOs + alerting.
4. Backups and restore runbooks.
5. Sensitive business-flow abuse protection (OWASP API6).
6. Delivery proof controls with one-time PIN and internal notification gating.

### Deliverables
1. `idempotency_keys` store and middleware.
2. Structured logs + metrics + trace IDs.
3. Runbooks for auth outage/payment callback failures/DB incidents.
4. Abuse-protection middleware: rate limit + velocity + risk scoring + temporary lock/challenge.
5. Delivery proof components:
- `delivery_proof_records` table
- in-app PIN sender and hashed PIN verifier
- status gate (`in_delivery -> delivered`) only after successful PIN verification

### Acceptance Criteria
1. Replay-safe writes for order create/payment start/payment webhook.
2. Alerting on payment webhook signature failures.
3. Recovery drill documented and tested.
4. High-risk flows (`payment_start`, `refund_request`, `pin_verify`) are protected by abuse controls and audited.
5. Delivery orders cannot be marked delivered/completed without valid PIN verification unless admin override with reason.

---

## 5) Admin Panel Data Grid Requirements

1. **DB-field parity is mandatory**:
- Admin list/detail views must be able to display every persisted field for each entity (including new fields added later).
2. **Column visibility controls**:
- Each table view must support show/hide columns at runtime.
3. **Preference persistence**:
- Column visibility preferences must be saved per admin user, per table.
4. **Safe defaults**:
- Default column sets should prioritize readability, but all fields must remain discoverable.
5. **Schema evolution support**:
- Newly added DB fields should appear as available columns automatically without code rewrites of table structure.
6. **Export alignment**:
- CSV/JSON export should respect currently visible columns (with an option to export all fields).

### Suggested Implementation
1. Add metadata endpoints for admin entities (field name, label, type, sortable/filterable flags).
2. Render admin grids from metadata + server payload instead of hardcoded column lists.
3. Add `admin_table_preferences` storage:
- `admin_user_id`, `table_key`, `visible_columns`, `column_order`, `updated_at`.

### Acceptance Criteria
1. For every admin entity table, user can toggle columns on/off.
2. Preferences are restored on reload/login.
3. New DB fields are available in column chooser without frontend redeploy for static column code.
4. Detail page can always show full raw record fallback for debugging/audit.

---

## 6) Milestone Plan

## M1: Foundation + Auth
1. Complete WS-A and WS-B.
2. Deliver working auth/app-admin separation.

## M2: Core APIs + Contracts
1. Complete WS-C.
2. Deliver stable `/v1` core endpoints with pagination standards.

## M3: Payments + Compliance
1. Complete WS-D and WS-E.
2. Deliver production-safe payment confirmation and compliance gating.

## M4: Finance + Admin Controls
1. Complete WS-F.
2. Deliver commission setting management + seller finance summary.

## M5: Hardening
1. Complete WS-G.
2. Deliver operational readiness baseline.

---

## 7) Testing Plan

1. Unit tests: validators, services, state transitions.
2. Integration tests: auth flows, payments callbacks, compliance transitions, commission snapshots.
3. API contract tests: ensure `/v1` schema compatibility.
4. E2E tests:
- buyer order -> payment start -> callback confirm -> seller lifecycle -> completion
- seller blocked by compliance
- commission change affects only future completions
 - allergen disclosure records are created at `pre_order` and `handover`, and `completed` is blocked when missing
 - records younger than `730 days` are never purged by retention jobs
 - refund request and chargeback case create dispute records with liability and finance adjustments
 - delivery PIN is sent via internal notification, verify success is required for delivered/completed
 - abuse protection throttles repeated `display-name-check`, `payment_start`, and `pin_verify` attempts
5. Identity uniqueness tests:
- duplicate display name rejected (case-insensitive/normalized)
- profile update to taken display name rejected
- display-name check endpoint returns `available=false` and suggestions for near matches

---

## 8) Definition of Done (API v2)

1. All planned endpoints are under `/v1` only.
2. Auth and admin auth are fully separated.
3. External payment confirmation is server-verified.
4. Compliance workflow is fully operational and enforced server-side.
5. Seller finance commission snapshot model is implemented and audited.
6. Idempotency is enforced for critical writes.
7. `new-plan.md` and implementation are consistent with no unresolved P0/P1 gaps.
8. Admin tables support field parity and column show/hide preferences.
9. Retention policy is enforced at `730 days` minimum with legal-hold awareness.
10. Allergen disclosure evidence (`pre_order` + `handover`) is stored and enforced in order lifecycle.
11. Refund/chargeback lifecycle is operational with liability assignment and immutable dispute history.
12. Delivery proof PIN flow is enforced for delivery completion with audited overrides only.
13. Reconciliation reports are generated and reconciled against finance ledgers.
14. OWASP API6-aligned abuse controls protect sensitive business flows.

---

## 9) Immediate Next Actions

1. Create API v2 skeleton and initial DB schema bootstrap.
2. Write OpenAPI v1 for Auth, Orders, Payments, Compliance, Finance first.
3. Implement WS-B (auth split) before all other business endpoints.
4. Add OpenAPI modules for disputes, delivery proof, reconciliation reports, and abuse error codes.
