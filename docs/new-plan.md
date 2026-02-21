## 1) Goal and Product Scope

Build **Coziyoo** as a dual-sided marketplace where:

1. Buyers discover and order home-cooked meals.
2. Sellers create listings, manage incoming orders, and handle fulfillment.
3. Both sides can chat per order.
4. Country-specific compliance rules apply (TR/UK).
5. An admin surface moderates users/content and audits actions.

Use this as a clean restart blueprint, not a patch of the trial codebase.

---

## 2) Recommended System Architecture (From Scratch)

1. **Mobile/Web App**: Expo + React Native + TypeScript + Expo Router.
2. **Backend API**: Node.js + Express + single primary database (MongoDB or PostgreSQL).
3. **Storage**: Firebase Storage or S3-compatible provider for media.
4. **Auth**: Backend-issued JWT access token + rotating refresh token flow (single auth authority).
5. **Admin Panel**: Separate React web app (Vite + React Query + MUI).
6. **Notifications**: Local notifications first, push notifications after backend event hooks are stable.

---

## 3) Core Entities (Canonical Data Model)

Define these first and keep them stable.

1. `User` (application users only: buyers/sellers)
- id, email, password_hash, display_name, display_name_normalized, full_name, user_type (`buyer|seller|both`), profile fields, country/language, compliance flags, is_active, created_at, updated_at.

2. `UserSettings`
- user_id, language, country_code, theme_preference, notifications_enabled, updated_at.

3. `UserAddress`
- id, user_id, title, address_line, is_default, created_at, updated_at.

4. `Category`
- id, name_tr, name_en, sort_order, is_active, created_at, updated_at.

5. `Food`
- id, seller_id, name, card_summary, description, recipe, category, country_code, price, image_url, ingredients(json), allergens(json), preparation_time_minutes, serving_size, delivery_fee, max_delivery_distance_km, available_delivery_options(json), current_stock, daily_stock, is_available, is_active, rating, review_count, favorite_count, created_at, updated_at.

6. `Favorite`
- user_id, food_id, created_at (composite key user_id+food_id).

7. `Order`
- id, food_id, buyer_id, seller_id, quantity, total_price, status, delivery_address, delivery_type, requested_date/time, estimated_delivery_time, payment_completed, order_date, created_at, updated_at.

8. `Chat`
- id, buyer_id, seller_id, order_id(optional), food_id(optional), last_message, last_message_time, last_message_sender, buyer_unread_count, seller_unread_count, is_active, created_at, updated_at.

9. `Message`
- id, chat_id, sender_id, sender_type, message, message_type (`text|image|order_update`), order_data(json), is_read, timestamp.

10. `Review`
- id, food_id, buyer_id, seller_id, order_id(optional), rating, comment, images(json), helpful_count, report_count, is_verified_purchase, created_at, updated_at.

11. `PaymentAttempt`
- id, order_id, buyer_id, provider, provider_session_id, provider_reference_id, status (`initiated|returned_success|returned_failed|confirmed|confirmation_failed`), callback_payload(json), created_at, updated_at.

12. `NotificationEvent`
- id, user_id, type, title, body, data(json), is_read, created_at.

13. `MediaAsset`
- id, provider, object_key, public_url, content_type, size_bytes, checksum, owner_user_id, related_entity_type, related_entity_id, status, metadata(json), created_at, updated_at.

14. `AdminUser` (management users only)
- id, email, password_hash, role (`admin|super_admin`), is_active, created_at, updated_at, last_login_at.

15. `AdminAuditLog`
- id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, created_at.

16. `ProductionLot` (HACCP/traceability)
- id, seller_id, food_id, lot_number, produced_at, use_by, best_before, quantity_produced, quantity_available, status (`open|locked|depleted|recalled|discarded`), notes, created_at, updated_at.

17. `OrderItemLotAllocation`
- id, order_id, order_item_id, lot_id, quantity_allocated, created_at.

18. `LotEvent`
- id, lot_id, event_type (`created|adjusted|locked|recalled|discarded`), event_payload(json), created_by, created_at.

19. `AllergenDisclosureRecord` (regulatory process evidence)
- id, order_id, phase (`pre_order|handover`), seller_id, buyer_id, food_id, allergen_snapshot(json), disclosure_method (`ui_ack|label|verbal|receipt_note`), buyer_confirmation (`acknowledged|refused|unreachable`), evidence_ref, occurred_at, created_at.

20. `DeliveryProofRecord`
- id, order_id, seller_id, buyer_id, proof_mode (`pin`), pin_hash, pin_sent_at, pin_sent_channel (`in_app`), pin_verified_at, verification_attempts, status (`pending|verified|failed|expired`), metadata_json, created_at.

21. `PaymentDisputeCase`
- id, order_id, payment_attempt_id, provider_case_id, case_type (`refund|chargeback`), reason_code, liability_party (`seller|platform|provider|shared`), liability_ratio_json, status (`opened|under_review|won|lost|closed`), opened_at, resolved_at, evidence_bundle_json, created_at, updated_at.

22. `FinanceReconciliationReport`
- id, actor_type (`seller|admin`), actor_id, report_type (`payout_summary|order_settlement|refund_chargeback|tax_base`), period_start, period_end, status (`queued|processing|ready|failed`), file_url, checksum, generated_at, created_at.

23. `AbuseRiskEvent`
- id, subject_type (`user|device|ip|session|order`), subject_id, flow (`signup|login|display_name_check|order_create|payment_start|refund_request|pin_verify`), risk_score, decision (`allow|challenge|deny|review`), reason_codes(json), request_fingerprint, created_at.

---

## 4) User Flows and Logic

### Auth + Onboarding
1. User opens app.
2. App resolves language/country (saved preference > detected locale > default).
3. User signs up/signs in.
4. User type chosen (`buyer`, `seller`, `both`).
5. AuthGuard redirects:
- seller/both -> seller dashboard.
- buyer -> buyer home.

### Buyer flow
1. Browse foods by category/search/filter/sort.
2. Open food detail, review ingredients/allergens, choose quantity/date/time/delivery mode.
3. Place order -> creates `Order` in `pending_seller_approval`.
4. Seller receives notification; chat room exists or is created.
5. Buyer tracks status and communicates through chat.
6. After completion, buyer leaves review (verified purchase check required).
7. Buyer can favorite foods and manage saved addresses.
8. Checkout redirects to external payment provider and returns with confirmation result.

### Seller flow
1. Create/edit/delete food listings.
2. Set availability, stock, delivery options, allergens, date window.
3. Review incoming orders.
4. Approve/reject pending orders.
5. Update order progress (`preparing`, `ready`, `delivered`).
6. Respond in chat.
7. Complete compliance documents (country-dependent).

### Admin flow
1. Admin login with role-based auth (separate management user store).
2. View dashboard counts (users, foods, orders, chats, reviews, media).
3. CRUD/audit for users, sellers, foods, orders, reviews, chats, media.
4. Any mutable admin action writes `AdminAuditLog`.

---

## 5) Critical Business Rules

1. **Order status machine** (cleaned):
- `pending_seller_approval -> seller_approved -> awaiting_payment -> paid -> preparing -> ready -> delivered -> completed`
- `pending_seller_approval -> rejected`
- Any pre-completion state can transition to `cancelled` under policy.

2. **Stock and capacity**
- On order create, reserve stock atomically.
- Prevent overselling with DB transaction and row lock.
- Release stock on rejection/cancel.

3. **Review eligibility**
- Only buyer who completed the order can review.
- One review per `(buyer_id, food_id, order_id)`.

4. **Favorites**
- Toggle by `(user_id, food_id)`.
- Maintain `favorite_count` on food with transactional consistency.

5. **External payment confirmation**
- Order enters `awaiting_payment` before redirect.
- After redirect-return, backend verifies provider confirmation (server-to-server or signed callback) before marking paid.
- Never trust query params alone from client redirect.
- Store each callback/return in `PaymentAttempt` for traceability.

6. **Chat integrity**
- One active chat per buyer/seller/order (or buyer/seller for generic pre-order chat).
- Sending message updates chat preview + unread counters.

7. **Country compliance**
- TR: compliance optional.
- UK: compliance required for seller activation.
- Keep compliance fields explicit; don’t hide failed compliance behind generic “pending”.

8. **Display name uniqueness**
- `display_name` must be globally unique across app users.
- Uniqueness check must be case-insensitive and normalization-based (`display_name_normalized`).
- Registration/profile update must fail with a stable validation error when name is taken.
- Client should perform debounced live availability checks during typing.

9. **Lot/batch traceability (HACCP-aligned)**
- Every production run of the same food must create a distinct `lot_number`.
- Order fulfillment must allocate quantities to specific lots and persist allocation records.
- Lot status must support recall (`recalled`) and prevent further allocation.
- Affected orders must be queryable by lot for rapid incident response.

10. **Record retention + allergen disclosure evidence**
- `record_retention_policy` is fixed to `2 years` (`730 days`) minimum for compliance, lot traceability, payment confirmation, and allergen disclosure logs.
- Before order confirmation, buyer must be shown allergens and a `pre_order` disclosure record must be written.
- At delivery/handover, seller must provide allergen info again and a `handover` disclosure record must be written.
- Orders cannot transition to `completed` unless required allergen disclosure records exist.
- Retention purge jobs must skip records under legal hold.

---

## 6) API Surface (Minimum Set, v1)

1. Auth: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `GET /v1/auth/me`.
2. Display Name: `GET /v1/auth/display-name/check?value=...` (availability + similarity suggestions).
3. Foods: `GET /v1/foods`, `GET /v1/foods/:id`, `POST /v1/foods`, `PUT /v1/foods/:id`, `DELETE /v1/foods/:id`.
4. Categories: `GET /v1/categories`.
5. Orders: `POST /v1/orders`, `GET /v1/orders`, `PUT /v1/orders/:id`, `POST /v1/orders/:id/status`.
6. Chats: `GET /v1/chats`, `POST /v1/chats`, `GET /v1/chats/:id/messages`, `POST /v1/chats/:id/messages`.
7. Reviews: `POST /v1/reviews`, `GET /v1/reviews?foodId=...`.
8. Favorites: `GET /v1/favorites`, `POST /v1/favorites/toggle`, `DELETE /v1/favorites/:foodId`.
9. Addresses: `GET /v1/addresses`, `POST /v1/addresses`, `PUT /v1/addresses/:id/default`, `DELETE /v1/addresses/:id`.
10. Payments: `POST /v1/payments/start`, `GET /v1/payments/return`, `POST /v1/payments/webhook`, `GET /v1/payments/:orderId/status`.
11. Media: `POST /v1/media/register`, `GET /v1/media/:id`.
12. Admin: `/v1/admin/*` CRUD and audit endpoints with admin auth.
13. Admin Auth: `POST /v1/admin/auth/login`, `POST /v1/admin/auth/refresh`, `POST /v1/admin/auth/logout`, `GET /v1/admin/auth/me`.
14. Lots:
- `POST /v1/seller/lots`
- `GET /v1/seller/lots?foodId=...`
- `POST /v1/seller/lots/:lotId/adjust`
- `POST /v1/seller/lots/:lotId/recall`
- `GET /v1/admin/lots`
- `GET /v1/admin/lots/:lotId/orders`
15. Allergen Disclosure:
- `POST /v1/orders/:id/allergen-disclosure/pre-order`
- `POST /v1/orders/:id/allergen-disclosure/handover`
- `GET /v1/orders/:id/allergen-disclosure`
16. Refund/Chargeback:
- `POST /v1/orders/:id/refund-request`
- `GET /v1/orders/:id/disputes`
- `POST /v1/payments/chargeback/webhook`
- `GET /v1/admin/disputes`
- `POST /v1/admin/disputes/:id/resolve`
17. Delivery Proof:
- `POST /v1/orders/:id/delivery-proof/pin/send`
- `POST /v1/orders/:id/delivery-proof/pin/verify`
- `GET /v1/orders/:id/delivery-proof`
18. Reconciliation Reports:
- `POST /v1/sellers/:sellerId/finance/reports`
- `GET /v1/sellers/:sellerId/finance/reports`
- `POST /v1/admin/finance/reports`
- `GET /v1/admin/finance/reports`

---

## 7) Build Plan (Execution Roadmap)

### Phase 0: Foundation
1. Create monorepo or clearly split folders (`app`, `server`, `admin-panel`).
2. Define environment strategy and secrets management.
3. Create shared TypeScript contracts for DTOs.

### Phase 1: Data + Backend
1. Write database migrations/schema changes for all entities above.
2. Add indexes and unique constraints early.
3. Implement auth, foods, orders, chats/messages, reviews.
4. Add favorites/addresses/payments/media/admin APIs.
5. Add validation layer (zod/joi) for all request payloads.
6. Add audit logging for all admin writes.

### Phase 2: Mobile App Core
1. Implement providers: Auth, Country, Language, Cart, Notification.
2. Implement route groups: `(auth)`, `(buyer)`, `(seller)`.
3. Implement AuthGuard redirect logic.
4. Implement buyer browsing + food detail + ordering.
5. Implement seller listing management + seller orders.
6. Implement chat and notifications.

### Phase 3: Advanced Features
1. Compliance forms and seller verification states.
2. Ratings/reviews UI with stats aggregation.
3. Media upload abstraction with provider swappable backend.

### Phase 4: Admin Panel
1. Auth + role enforcement.
2. Dashboard, list/detail pages, status controls.
3. Full audit log viewer with filters.

### Phase 5: Hardening
1. Add tests (unit + integration + API contract + smoke E2E).
2. Security pass (auth, rate limit, input sanitization, storage policy).
3. Performance pass (query tuning, pagination, lazy loading).
4. Rollout plan (staging -> production).

---

## 8) Testing Strategy You Should Enforce

1. Unit tests for services and reducers/contexts.
2. API integration tests for all status transitions and permission checks.
3. DB migration tests (up/down, idempotency).
4. E2E scenarios:
- Buyer registers -> orders -> seller approves -> buyer tracks -> review submitted.
- Seller listing lifecycle (create/edit/deactivate).
- Admin moderation and audit log presence.
5. Contract tests to keep frontend and backend schemas synchronized.

---

## 9) Security and Production Rules

1. Never store plaintext passwords.
2. Enforce JWT expiry + refresh rotation.
3. Add per-route authorization checks (buyer can’t mutate seller resources).
4. Validate all incoming payloads server-side.
5. Add rate limiting and brute-force protection on auth routes.
6. Enforce secure file upload checks (mime, size, extension, ownership).
7. Keep PII and payment data minimized; never store card PAN/CVV, only provider references and confirmation metadata.

---

## 10) Known Trial-Project Gaps to Avoid in Rewrite

1. Mixed mock/real data paths causing inconsistent behavior.
2. Divergent internal vs remote API route support.
3. Status enums differing between screens/services.
4. Non-atomic stock/payment confirmation/order updates.
5. UI-level assumptions without DB constraints.
6. Compliance logic partly UI-only (must be backend-enforced).
7. Missing unified “shared contract” package for DTO/status enums.

---

## 11) Final Recommendation

Start from this order:

1. Freeze domain model and order status machine first.
2. Build backend + migrations + tests second.
3. Build mobile flows against real API third.
4. Add admin panel and operational tooling last.

If you want, next I can generate a full **implementation checklist by file/folder**, including exact DTO interfaces, DB schema templates, and endpoint-by-endpoint acceptance criteria.

---

## 12) Design Review Findings (Mistakes and Risks)

### P0 (Critical)
1. **Auth architecture is ambiguous** (`new-plan.md:20`).
- Plan says JWT *or* Firebase Auth, but no final decision. This creates incompatible backend responsibilities (token validation, user lifecycle, refresh flow).
- **Fix**: Choose one auth authority for v1. Recommended: backend-issued JWT + refresh tokens; Firebase can remain only for media/push integration.

2. **Order lifecycle is underspecified for money safety** (`new-plan.md:121`).
- Flow includes seller approval states, but no hard rules for payment capture timing, expiry, cancellation windows, or refund triggers.
- **Fix**: Add explicit state machine with guards, expiry job, and refund/dispute branches.

3. **No idempotency strategy for create-order/payment-start endpoints** (`new-plan.md:161`).
- Retries can create duplicate orders/payment sessions.
- **Fix**: Require `Idempotency-Key` for order create and payment session start.

### P1 (High)
4. **Redirect-return payment confirmation is vulnerable if not server-verified** (`new-plan.md:139`).
- Client return query can be forged.
- **Fix**: Final confirmation must come from provider webhook/signature verification before order paid transition.

6. **API surface lacks versioning and pagination conventions** (`new-plan.md:156`).
- Long-term breaking changes become expensive.
- **Fix**: Add `/v1` prefix, standard list params (`page,pageSize,sortBy,sortDir,q`), and cursor option for chat/messages.

7. **RBAC/ABAC policy not defined for dual-role users** (`new-plan.md:31`, `new-plan.md:112`).
- `both` users need explicit active role context per request.
- **Fix**: Add role context claim or header, and enforce endpoint policy matrix.

8. **Compliance is listed but not operationalized** (`new-plan.md:149`).
- No approval workflow, evidence storage policy, or required fields by country.
- **Fix**: Add `seller_compliance_status` state model + document verification queue + admin decisions with audit trail.

### P2 (Medium)
9. **No data retention/deletion policy for GDPR/KVKK** (`new-plan.md:227`).
- Missing export/delete/anonymization flows.
- **Fix**: Add privacy operations, retention windows, and legal hold behavior.

10. **Observability/DR not in rollout** (`new-plan.md:206`).
- No SLOs, alerting, backups, restore testing.
- **Fix**: Add metrics/logging/tracing, backup cadence, and recovery drills.

11. **Content abuse controls not defined for chat/reviews** (`new-plan.md:145`).
- Missing spam/rate limits/report workflow automation.
- **Fix**: Add per-user rate limit, abuse reports queue, and moderation tooling.

---

## 13) Corrected Architecture Decisions (Lock These for v1)

1. **Auth**: Backend JWT access token (15 min) + refresh token (30 days, rotating, revocable).
2. **Auth Authority**: Backend is the only authentication authority (no dual authority with Firebase Auth).
3. **Database Compatibility**: Auth/session model must work with MongoDB and PostgreSQL using the same API contract.
4. **Payments**: External provider-hosted checkout redirect; server stores only provider session/reference IDs and confirmed status.
5. **API Contract**: Versioned REST (`/v1/*`) with strict schemas and shared TypeScript DTO package.
6. **Media**: Provider abstraction, but v1 uses one provider in production to reduce complexity.
7. **Notifications**: Domain events in backend -> notification worker -> push/local channels.
8. **Admin Security**: Separate auth realm, short-lived admin tokens, mandatory audit log on all mutable operations.

### Authorization and Session Storage (MongoDB or PostgreSQL)
1. `users` / `users` collection (app users only):
- `id` (UUID/string), `email` (unique), `display_name` (unique), `display_name_normalized` (unique), `password_hash`, `user_type`, `is_active`, `created_at`, `updated_at`.
2. `admin_users` / `admin_users` collection (management users only):
- `id`, `email` (unique), `password_hash`, `role`, `is_active`, `created_at`, `updated_at`, `last_login_at`.
3. `auth_sessions` table or `auth_sessions` collection (app sessions):
- `id`, `user_id`, `refresh_token_hash`, `expires_at`, `revoked_at`, `device_info`, `ip`, `created_at`, `last_used_at`.
4. `admin_auth_sessions` table or `admin_auth_sessions` collection (management sessions):
- `id`, `admin_user_id`, `refresh_token_hash`, `expires_at`, `revoked_at`, `device_info`, `ip`, `created_at`, `last_used_at`.
5. `auth_audit` table or `auth_audit` collection:
- `id`, `user_id` (nullable), `event_type` (`login_success|login_failed|refresh|logout|logout_all`), `ip`, `user_agent`, `created_at`.
6. `admin_auth_audit` table or collection:
- `id`, `admin_user_id` (nullable), `event_type` (`admin_login_success|admin_login_failed|admin_refresh|admin_logout|admin_logout_all`), `ip`, `user_agent`, `created_at`.
7. MongoDB index requirements:
- unique index on `users.email`, unique index on `users.display_name_normalized`, unique index on `admin_users.email`,
- index on `auth_sessions.user_id`, `auth_sessions.expires_at`, `auth_sessions.revoked_at`,
- index on `admin_auth_sessions.admin_user_id`, `admin_auth_sessions.expires_at`, `admin_auth_sessions.revoked_at`.
8. PostgreSQL index requirements:
- unique index on `users(email)`, unique index on `users(display_name_normalized)`, unique index on `admin_users(email)`,
- indexes on `auth_sessions(user_id)`, `auth_sessions(expires_at)`, partial index for active app sessions (`revoked_at IS NULL`),
- indexes on `admin_auth_sessions(admin_user_id)`, `admin_auth_sessions(expires_at)`, partial index for active admin sessions (`revoked_at IS NULL`).
9. Token policy:
- store only hashed refresh tokens; rotate on every refresh; revoke old token atomically.
10. Authorization policy:
- app endpoints accept only app JWTs from `users`.
- admin endpoints accept only admin JWTs from `admin_users`.
- enforce explicit route-level policy matrix for app roles (`buyer|seller|both`) and management roles (`admin|super_admin`).

---

## 14) Expanded Domain Rules (Add to Requirements)

### Order State Machine (Authoritative)
1. `draft` (optional cart snapshot) -> `pending_seller_approval`.
2. `pending_seller_approval` -> `seller_approved` or `rejected` or `expired`.
3. `seller_approved` -> `awaiting_payment` -> `paid` -> `preparing`.
4. `preparing` -> `ready` -> `in_delivery` (if delivery) -> `delivered`.
5. `delivered` -> `completed` (auto after T+24h if no dispute).
6. Cancellation allowed by policy windows:
- buyer cancel before `preparing`.
- seller cancel only with reason codes.
7. Refund/dispute:
- `refund_pending` -> `refunded` or `refund_rejected`.

### Payment Rules (External Provider)
1. App initiates payment session via backend, never directly from client with secret keys.
2. `return` endpoint is UX-only; paid state is set only after verified provider callback.
3. Save raw callback payload and signature verification result for audits.
4. If callback fails temporarily, keep order in `awaiting_payment` and retry verification job.

### Identity and Compliance
1. Seller compliance lifecycle: `not_started -> in_progress -> submitted -> under_review -> approved|rejected -> suspended`.
2. UK requires all required compliance checks verified before listing activation.
3. TR allows listing with optional-doc warnings, but required baseline checks must pass.
4. Compliance status is enforced server-side on seller-sensitive endpoints (listing create/activate, order handling).
5. Admin review actions must always write audit entries.

### Lot Traceability Rules
1. Lot number format should be deterministic and unique (example: `CZ-{FOODCODE}-{YYYYMMDD}-{SEQ}`).
2. Lot allocation strategy should be FEFO (first-expiry-first-out) by default.
3. Stock visible to buyers is derived from sum of `quantity_available` for `open` lots.
4. Allocation and stock decrement must happen in one DB transaction.
5. Recalled/discarded lots cannot be allocated to new orders.

---

## 15) Expanded API Blueprint (v1)

### Auth
1. `POST /v1/auth/register`
2. `POST /v1/auth/login`
3. `POST /v1/auth/refresh`
4. `POST /v1/auth/logout`
5. `GET /v1/auth/me`
6. `GET /v1/auth/display-name/check?value=...`

### Admin Auth
1. `POST /v1/admin/auth/login`
2. `POST /v1/admin/auth/refresh`
3. `POST /v1/admin/auth/logout`
4. `GET /v1/admin/auth/me`

### Compliance (Seller + Admin)
1. `GET /v1/seller/compliance/profile`
2. `PUT /v1/seller/compliance/profile`
3. `POST /v1/seller/compliance/documents`
4. `GET /v1/seller/compliance/documents`
5. `POST /v1/seller/compliance/submit`
6. `GET /v1/admin/compliance/queue`
7. `GET /v1/admin/compliance/:sellerId`
8. `POST /v1/admin/compliance/:sellerId/approve`
9. `POST /v1/admin/compliance/:sellerId/reject`
10. `POST /v1/admin/compliance/:sellerId/request-changes`

### Lot Traceability
1. `POST /v1/seller/lots`
2. `GET /v1/seller/lots?foodId=...`
3. `POST /v1/seller/lots/:lotId/adjust`
4. `POST /v1/seller/lots/:lotId/recall`
5. `GET /v1/admin/lots`
6. `GET /v1/admin/lots/:lotId/orders`

### Orders and Payments
1. `POST /v1/orders` (idempotent)
2. `POST /v1/orders/:id/approve` (seller)
3. `POST /v1/orders/:id/reject` (seller)
4. `POST /v1/orders/:id/cancel` (policy-checked)
5. `POST /v1/orders/:id/status` (controlled transitions only)
6. `POST /v1/payments/start`
7. `GET /v1/payments/return`
8. `POST /v1/payments/webhook` (PSP callback endpoint)
9. `GET /v1/payments/:orderId/status`

### Shared Standards
1. All writes accept `Idempotency-Key`.
2. All list endpoints support pagination and sorting.
3. Error envelope uses stable codes (`ORDER_INVALID_STATE`, `INSUFFICIENT_BALANCE`, etc.).

---

## 16) API Versioning and Pagination Contract

### Versioning Rules
1. All public endpoints must be versioned with `/v1`.
2. Breaking contract changes require a new version (`/v2`), never silent changes in `/v1`.
3. Deprecation policy: keep prior major API version available for a defined migration window (recommended: 90 days minimum).
4. API docs and shared TypeScript contracts must be version-aligned with endpoint versions.

### Pagination Modes
1. `offset` mode for admin grids and low-write list pages.
2. `cursor` mode for feed-like, high-write, time-ordered data.
3. Default limits:
- `pageSize`/`limit`: default `20`, max `100`.

### Query Standards
1. Offset query params:
- `page` (>=1), `pageSize`, `sortBy`, `sortDir` (`asc|desc`), `q` (search).
2. Cursor query params:
- `cursor` (opaque), `limit`, `sortDir`.
3. Unknown sort fields or malformed pagination params return validation errors.

### Response Standards
1. Offset response:
```json
{
  "data": [],
  "pagination": {
    "mode": "offset",
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```
2. Cursor response:
```json
{
  "data": [],
  "pagination": {
    "mode": "cursor",
    "limit": 20,
    "nextCursor": null,
    "hasMore": false
  }
}
```

### Sorting and Filtering Rules
1. Every list endpoint must define an explicit allowlist of `sortBy` fields.
2. Use stable tie-breakers to avoid duplicates/missing rows across pages (example: `createdAt DESC, id DESC`).
3. Search field behavior (`q`) must be documented per endpoint.

### Error Codes (Pagination/Versioning)
1. `PAGINATION_INVALID`
2. `SORT_FIELD_INVALID`
3. `CURSOR_INVALID`
4. `API_VERSION_UNSUPPORTED`

### Endpoint Pagination Mapping (v1)
1. Cursor mode:
- `GET /v1/chats`
- `GET /v1/chats/:id/messages`
- `GET /v1/orders`
2. Offset mode:
- `GET /v1/admin/users`
- `GET /v1/admin/orders`
- `GET /v1/admin/foods`
- `GET /v1/admin/reviews`
- `GET /v1/admin/audit-logs`
- `GET /v1/sellers/:sellerId/finance/orders`

---

## 17) Compliance Workflow (Operational)

### Compliance State Model
1. `not_started`
2. `in_progress`
3. `submitted`
4. `under_review`
5. `approved`
6. `rejected`
7. `suspended`

### Country Policy Rules
1. TR policy:
- Required baseline checks must pass.
- Optional documents can remain incomplete with warnings.
2. UK policy:
- All required checks must be verified before seller can publish/activate listings.
- Missing or rejected required checks keep seller blocked.

### Compliance Data Model
1. `seller_compliance_profiles`
- `seller_id`, `country_code`, `status`, `submitted_at`, `approved_at`, `rejected_at`, `reviewed_by_admin_id`, `review_notes`, `updated_at`.
2. `seller_compliance_documents`
- `id`, `seller_id`, `doc_type`, `file_url`, `metadata_json`, `status` (`pending|verified|rejected`), `rejection_reason`, `uploaded_at`, `reviewed_at`, `reviewed_by_admin_id`.
3. `seller_compliance_checks`
- `seller_id`, `check_code`, `required`, `value_json`, `status`, `updated_at`.
4. `seller_compliance_events`
- immutable event history for all transitions and review actions.
5. `allergen_disclosure_records`
- immutable process records for `pre_order` and `handover` disclosures with evidence metadata.

### Operational Flow
1. Seller fills profile/checks and uploads documents.
2. Backend evaluates required checks based on seller country policy.
3. Seller submits; status moves to `submitted` then `under_review`.
4. Admin reviews queue and approves/rejects checks/docs.
5. Backend resolves final status:
- all required checks verified -> `approved`
- any required check rejected -> `rejected`
6. Seller can fix and resubmit after rejection/request-changes.
7. Every review decision writes both compliance event and admin audit log.
8. System creates and stores allergen disclosure evidence:
- `pre_order` during checkout confirmation.
- `handover` at delivery completion step.

### Server-Side Enforcement Gates
1. `POST /v1/foods` and listing activation endpoints require allowed compliance status.
2. Seller operational endpoints (example: order acceptance) are blocked when status is `suspended`.
3. UI checks are advisory only; backend checks are authoritative.
4. `completed` order transition requires both disclosure phases (`pre_order` + `handover`) unless policy explicitly marks order as exception with reason.

### Lot/Recall Operational Traceability
1. Every seller production run requires a new lot record before stock can be sold.
2. Order confirmation must persist lot allocations for each order item.
3. Recall action must mark lot `recalled` and block future allocations immediately.
4. Admin recall view must list all orders allocated from the recalled lot.

### Record Retention Policy
1. Global `record_retention_policy` is `2 years` (`730 days`).
2. Minimum retention scope:
- compliance profiles/documents/checks/events
- lot/allocation/recall records
- order/payment attempts and callback verification metadata
- allergen disclosure process records (`pre_order` + `handover`)
3. Purge/anonymization jobs run only after retention window and must honor legal hold flags.
4. Admin panel must expose retention and legal-hold status for auditability.

---

## 18) Expanded Delivery Plan (Practical)

### Phase 0.5: Architecture Freeze (New)
1. Freeze auth/payment choices and state machine.
2. Publish API spec (OpenAPI) before feature coding.
3. Define RBAC matrix by endpoint.

### Phase 1.5: Reliability Layer (New)
1. Add background worker for payment confirmation retries, order expiry, and notification retries.
2. Add outbox pattern for reliable event delivery.
3. Add dead-letter queue and retry policy.

### Phase 5.5: Operations Readiness (New)
1. SLOs: API latency, order success rate, payment confirmation success rate.
2. Alerting: error spikes, payment callback failures, webhook signature failures.
3. Backups: PITR enabled, monthly restore drill.
4. Incident runbooks for auth outage/payment outage/data corruption.

---

## 19) Seller Finance and Commission (Admin-Configurable)

### Commission Policy
1. Default commission rate is `10%`.
2. Commission is applied only when an order becomes `completed`.
3. Per-order calculations:
- `gross_amount = order.total_price`
- `commission_amount = round(gross_amount * commission_rate_snapshot, 2)`
- `seller_net_amount = gross_amount - commission_amount`

### Historical Integrity Rule
1. Every finalized order stores `commission_rate_snapshot`.
2. Changing commission from admin affects only future finalized orders.
3. Existing finance rows are immutable and must not be recalculated.

### Admin Control
1. Admin panel includes a `Commission Settings` page.
2. Admin can change active commission rate (example: `0.10` -> `0.12`).
3. Change is versioned and auditable with:
- `changed_by`
- `changed_at`
- `previous_rate`
- `new_rate`

### Recommended Data Model
1. `commission_settings`
- `id`, `commission_rate`, `is_active`, `effective_from`, `created_by`, `created_at`
2. `order_finance`
- `order_id` (unique), `seller_id`, `gross_amount`, `commission_rate_snapshot`, `commission_amount`, `seller_net_amount`, `finalized_at`
3. `finance_adjustments` (for refunds/disputes)
- `id`, `order_id`, `seller_id`, `type`, `amount`, `reason`, `created_at`

### Seller Finance Screen Requirements
1. `Total Selling Amount` = sum of `gross_amount` from finalized rows.
2. `Total Commission` = sum of `commission_amount`.
3. `Total Net Earnings` = sum of `seller_net_amount` plus adjustments.
4. Completed order list with order-level gross, rate snapshot, commission, net.

### API Additions
1. `GET /v1/admin/commission-settings` (admin)
2. `POST /v1/admin/commission-settings` (admin, creates new active version)
3. `GET /v1/sellers/:sellerId/finance/summary`
4. `GET /v1/sellers/:sellerId/finance/orders`

### Processing Rules
1. Finance finalization is idempotent per `order_id`.
2. Use DB transaction when moving order to `completed` and inserting `order_finance`.
3. If refund happens later, add adjustment entry; do not mutate original finalized row.

---

## 20) Dispute, Delivery Proof, Reconciliation, Abuse Controls

### Refund/Chargeback Responsibility Workflow
1. Refund and chargeback are separate but linked flows:
- Refund: platform-initiated correction request for an order issue.
- Chargeback: provider/bank initiated dispute from cardholder side.
2. Every case must create immutable `PaymentDisputeCase` history entries.
3. Liability assignment is mandatory per case:
- `seller`, `platform`, `provider`, or `shared` with ratio.
4. Payout impact must be applied through `finance_adjustments`; do not mutate `order_finance`.
5. Evidence bundle must include order timeline, delivery proof status, allergen disclosure records, and chat excerpts (policy-filtered).

### Delivery Proof Controls (PIN + Internal Notification)
1. For delivery orders, system must send one-time delivery PIN to buyer via internal in-app notification before handover.
2. Seller can mark order `delivered` only after PIN verification succeeds.
3. PIN is stored hashed, short TTL (recommended 10 minutes), max retry attempts (recommended 5).
4. Failed/expired PIN requires regenerate flow with abuse controls and audit.
5. Manual override is admin-only with mandatory reason and audit log.

### Finance Reconciliation Reports
1. Reconciliation reports must be available for seller and admin for selected date ranges.
2. Minimum report families:
- payout summary
- order settlement details
- refund/chargeback adjustments
- tax-base exports
3. Reports are generated asynchronously, checksummed, and downloadable (CSV/JSON).
4. Report totals must reconcile to `order_finance + finance_adjustments`.

### Sensitive Flow Abuse Protection (OWASP API6)
1. Protect business-critical flows against excessive automated actions:
- signup/login
- display name availability checks
- order create/payment start
- refund requests
- delivery PIN verify/regenerate
2. Required controls:
- per-IP + per-account rate limits
- velocity limits per action window
- idempotency keys on monetary writes
- risk scoring and step-up challenge/temporary lock
3. All deny/challenge decisions must write `AbuseRiskEvent`.
4. Abuse protection must fail closed for high-risk monetary actions.

---

## 21) Database Schema (Greenfield Initial, PostgreSQL)

This is the initial production schema for a brand-new database (no migration from legacy data).

### Core Identity
1. `users`
- PK: `id` (uuid)
- Columns: `email` (unique), `password_hash`, `display_name` (unique), `display_name_normalized` (unique), `full_name`, `user_type`, `is_active`, `country_code`, `language`, `created_at`, `updated_at`
- Indexes: `idx_users_user_type`, `idx_users_country`
2. `admin_users`
- PK: `id`
- Columns: `email` (unique), `password_hash`, `role`, `is_active`, `last_login_at`, `created_at`, `updated_at`
3. `auth_sessions`
- PK: `id`
- FK: `user_id -> users.id`
- Columns: `refresh_token_hash`, `expires_at`, `revoked_at`, `device_info`, `ip`, `created_at`, `last_used_at`
- Indexes: `idx_auth_sessions_user`, `idx_auth_sessions_exp`, partial active index (`revoked_at IS NULL`)
4. `admin_auth_sessions`
- PK: `id`
- FK: `admin_user_id -> admin_users.id`
- Columns: `refresh_token_hash`, `expires_at`, `revoked_at`, `device_info`, `ip`, `created_at`, `last_used_at`

### Catalog and Ordering
1. `categories`
- PK: `id`
- Columns: `name_tr`, `name_en`, `sort_order`, `is_active`, `created_at`, `updated_at`
2. `foods`
- PK: `id`
- FK: `seller_id -> users.id`, `category_id -> categories.id`
- Columns: `name`, `card_summary`, `description`, `recipe`, `country_code`, `price`, `image_url`, `ingredients_json`, `allergens_json`, `preparation_time_minutes`, `serving_size`, `delivery_fee`, `max_delivery_distance_km`, `delivery_options_json`, `current_stock`, `daily_stock`, `is_available`, `is_active`, `rating`, `review_count`, `favorite_count`, `created_at`, `updated_at`
- Indexes: `idx_foods_seller`, `idx_foods_category`, `idx_foods_active`, full-text/trgm search index on name/summary
3. `favorites`
- PK: composite (`user_id`, `food_id`)
- FK: `user_id -> users.id`, `food_id -> foods.id`
- Columns: `created_at`
4. `user_addresses`
- PK: `id`
- FK: `user_id -> users.id`
- Columns: `title`, `address_line`, `is_default`, `created_at`, `updated_at`
- Constraint: max one default address per user (partial unique index on `user_id WHERE is_default`)
5. `orders`
- PK: `id`
- FK: `buyer_id -> users.id`, `seller_id -> users.id`
- Columns: `status`, `delivery_type`, `delivery_address_json`, `total_price`, `requested_at`, `estimated_delivery_time`, `payment_completed`, `created_at`, `updated_at`
- Indexes: `idx_orders_buyer`, `idx_orders_seller`, `idx_orders_status`, `idx_orders_created`
6. `order_items`
- PK: `id`
- FK: `order_id -> orders.id`, `food_id -> foods.id`
- Columns: `quantity`, `unit_price`, `line_total`, `created_at`
- Unique: (`order_id`, `food_id`)
7. `order_events`
- PK: `id`
- FK: `order_id -> orders.id`, `actor_user_id -> users.id` nullable
- Columns: `event_type`, `from_status`, `to_status`, `payload_json`, `created_at`

### Payments, Disputes, Finance
1. `payment_attempts`
- PK: `id`
- FK: `order_id -> orders.id`, `buyer_id -> users.id`
- Columns: `provider`, `provider_session_id`, `provider_reference_id`, `status`, `callback_payload_json`, `signature_valid`, `created_at`, `updated_at`
- Unique: `provider_session_id`, `provider_reference_id`
2. `commission_settings`
- PK: `id`
- FK: `created_by -> admin_users.id`
- Columns: `commission_rate`, `is_active`, `effective_from`, `created_at`
3. `order_finance`
- PK: `id`
- FK: `order_id -> orders.id` (unique), `seller_id -> users.id`
- Columns: `gross_amount`, `commission_rate_snapshot`, `commission_amount`, `seller_net_amount`, `finalized_at`
4. `finance_adjustments`
- PK: `id`
- FK: `order_id -> orders.id`, `seller_id -> users.id`, `dispute_case_id -> payment_dispute_cases.id` nullable
- Columns: `type`, `amount`, `reason`, `created_at`
5. `payment_dispute_cases`
- PK: `id`
- FK: `order_id -> orders.id`, `payment_attempt_id -> payment_attempts.id`
- Columns: `provider_case_id`, `case_type`, `reason_code`, `liability_party`, `liability_ratio_json`, `status`, `evidence_bundle_json`, `opened_at`, `resolved_at`, `created_at`, `updated_at`
- Unique: `provider_case_id`
6. `finance_reconciliation_reports`
- PK: `id`
- Columns: `actor_type`, `actor_id`, `report_type`, `period_start`, `period_end`, `status`, `file_url`, `checksum`, `generated_at`, `created_at`

### Compliance, Traceability, Delivery Proof
1. `seller_compliance_profiles`
- PK: `seller_id` (FK -> users.id)
- Columns: `country_code`, `status`, `submitted_at`, `approved_at`, `rejected_at`, `reviewed_by_admin_id`, `review_notes`, `updated_at`
2. `seller_compliance_documents`
- PK: `id`
- FK: `seller_id -> users.id`, `reviewed_by_admin_id -> admin_users.id` nullable
- Columns: `doc_type`, `file_url`, `metadata_json`, `status`, `rejection_reason`, `uploaded_at`, `reviewed_at`
3. `seller_compliance_checks`
- PK: `id`
- FK: `seller_id -> users.id`
- Columns: `check_code`, `required`, `value_json`, `status`, `updated_at`
- Unique: (`seller_id`, `check_code`)
4. `seller_compliance_events`
- PK: `id`
- FK: `seller_id -> users.id`, `actor_admin_id -> admin_users.id` nullable
- Columns: `event_type`, `payload_json`, `created_at`
5. `production_lots`
- PK: `id`
- FK: `seller_id -> users.id`, `food_id -> foods.id`
- Columns: `lot_number` (unique), `produced_at`, `use_by`, `best_before`, `quantity_produced`, `quantity_available`, `status`, `notes`, `created_at`, `updated_at`
6. `order_item_lot_allocations`
- PK: `id`
- FK: `order_id -> orders.id`, `order_item_id -> order_items.id`, `lot_id -> production_lots.id`
- Columns: `quantity_allocated`, `created_at`
7. `lot_events`
- PK: `id`
- FK: `lot_id -> production_lots.id`
- Columns: `event_type`, `event_payload_json`, `created_by`, `created_at`
8. `allergen_disclosure_records`
- PK: `id`
- FK: `order_id -> orders.id`, `seller_id -> users.id`, `buyer_id -> users.id`, `food_id -> foods.id`
- Columns: `phase`, `allergen_snapshot_json`, `disclosure_method`, `buyer_confirmation`, `evidence_ref`, `occurred_at`, `created_at`
- Unique: (`order_id`, `phase`)
9. `delivery_proof_records`
- PK: `id`
- FK: `order_id -> orders.id`, `seller_id -> users.id`, `buyer_id -> users.id`
- Columns: `proof_mode`, `pin_hash`, `pin_sent_at`, `pin_sent_channel`, `pin_verified_at`, `verification_attempts`, `status`, `metadata_json`, `created_at`
- Unique: `order_id`

### Communication, Reviews, Notifications, Admin
1. `chats`
- PK: `id`
- FK: `buyer_id -> users.id`, `seller_id -> users.id`, `order_id -> orders.id` nullable
- Columns: `last_message`, `last_message_time`, `last_message_sender`, `buyer_unread_count`, `seller_unread_count`, `is_active`, `created_at`, `updated_at`
2. `messages`
- PK: `id`
- FK: `chat_id -> chats.id`, `sender_id -> users.id`
- Columns: `sender_type`, `message`, `message_type`, `order_data_json`, `is_read`, `created_at`
- Indexes: `idx_messages_chat_created`
3. `reviews`
- PK: `id`
- FK: `food_id -> foods.id`, `buyer_id -> users.id`, `seller_id -> users.id`, `order_id -> orders.id`
- Columns: `rating`, `comment`, `images_json`, `helpful_count`, `report_count`, `is_verified_purchase`, `created_at`, `updated_at`
- Unique: (`buyer_id`, `food_id`, `order_id`)
4. `notification_events`
- PK: `id`
- FK: `user_id -> users.id`
- Columns: `type`, `title`, `body`, `data_json`, `is_read`, `created_at`
5. `media_assets`
- PK: `id`
- FK: `owner_user_id -> users.id`
- Columns: `provider`, `object_key`, `public_url`, `content_type`, `size_bytes`, `checksum`, `related_entity_type`, `related_entity_id`, `status`, `metadata_json`, `created_at`, `updated_at`
6. `admin_audit_logs`
- PK: `id`
- FK: `actor_admin_id -> admin_users.id`
- Columns: `actor_email`, `actor_role`, `action`, `entity_type`, `entity_id`, `before_json`, `after_json`, `created_at`
7. `auth_audit`
- PK: `id`
- FK: `user_id -> users.id` nullable
- Columns: `event_type`, `ip`, `user_agent`, `created_at`
8. `admin_auth_audit`
- PK: `id`
- FK: `admin_user_id -> admin_users.id` nullable
- Columns: `event_type`, `ip`, `user_agent`, `created_at`
9. `abuse_risk_events`
- PK: `id`
- Columns: `subject_type`, `subject_id`, `flow`, `risk_score`, `decision`, `reason_codes_json`, `request_fingerprint`, `created_at`
10. `idempotency_keys`
- PK: `id`
- Columns: `scope`, `key_hash`, `request_hash`, `response_status`, `response_body_json`, `expires_at`, `created_at`
- Unique: (`scope`, `key_hash`)

### Global Constraints and Policies
1. All tables include `created_at`; mutable tables include `updated_at`.
2. Monetary columns use `numeric(12,2)`; rates use `numeric(5,4)`.
3. Enumerations are DB-level constrained (enum types or check constraints).
4. All FK relations use explicit `ON DELETE` policy (`RESTRICT` by default, `CASCADE` only for dependent child records).
5. Retention rule: compliance/payment/traceability/allergen/dispute logs are retained minimum `730 days` with legal-hold override.
