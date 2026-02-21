# Operations Runbooks

## 1) Auth Outage

1. Confirm `/v1/health` and DB connectivity.
2. Check `auth_audit` and `admin_auth_audit` spikes for `login_failed` or `refresh` errors.
3. Validate JWT secrets (`APP_JWT_SECRET`, `ADMIN_JWT_SECRET`) are loaded.
4. Verify `auth_sessions` / `admin_auth_sessions` expiration and revoke anomalies.
5. If root cause is config drift, roll back environment variables to last known good values.
6. After mitigation, run smoke flow: register/login/refresh/me (app + admin).

## 2) Payment Callback Failures

1. Monitor webhook failures (`WEBHOOK_SIGNATURE_INVALID`, `confirmation_failed`).
2. Inspect `payment_attempts` rows for `signature_valid = FALSE`.
3. Validate `PAYMENT_WEBHOOK_SECRET` and provider signature header configuration.
4. Reprocess failed callbacks via provider replay, then verify order status transition.
5. Ensure return endpoint is not used as payment authority.

## 3) Database Incident

1. Immediately enable write protection at ingress if corruption is suspected.
2. Confirm PITR/backup checkpoint and select restore timestamp.
3. Restore in staging first; run smoke tests (`auth/orders/payments/compliance/finance`).
4. Promote restored DB only after reconciliation checks (`order_finance + finance_adjustments`).
5. Document incident timeline and corrective actions.

## 4) Outbox Retry Worker

1. Run `npm run outbox:process` on schedule.
2. Check backlog:
   - `SELECT count(*) FROM outbox_events WHERE status IN ('pending','failed');`
3. Check dead letters:
   - `SELECT * FROM outbox_dead_letters ORDER BY failed_at DESC LIMIT 50;`
4. For poison events, fix payload/handler and requeue manually by cloning into `outbox_events`.

