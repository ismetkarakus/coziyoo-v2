---
phase: 1
slug: supabase-db-cutover
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-03-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | apps/api/vitest.config.ts |
| **Quick run command** | `npm run test:api -- --run` |
| **Full suite command** | `npm run test:api -- --run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:api -- --run`
- **After every plan wave:** Run `npm run test:api -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | DB-01 | integration | `npm run test:api -- --run` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | DB-01 | manual | curl smoke test | ✅ | ✅ green |
| 1-02-01 | 02 | 2 | DB-02 | manual | curl smoke test script | ✅ | ✅ green |
| 1-03-01 | 03 | 3 | DB-03 | integration | `npm run test:api -- --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/api/src/db/migrations/0006_user_memory_tables.sql` — migration stub for DB-03
- [x] `installation/scripts/smoke-test.sh` — curl-based smoke test script for DB-02

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| API endpoints return correct data from Supabase | DB-02 | Vitest mocks DB; real connectivity requires live Supabase | Run `bash installation/scripts/smoke-test.sh` after env swap |
| SSL connection to Supabase pooler works | DB-01 | Runtime connectivity, not unit-testable | Check API startup logs; confirm no SSL errors |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

## Execution Notes

- 2026-03-12: Verified API starts against Supabase pooler with `DATABASE_SSL_MODE=no-verify`.
- 2026-03-12: `installation/scripts/smoke-test.sh` passed on health/auth/orders/payments/finance.
- 2026-03-12: Applied `0006_user_memory_tables.sql` directly to Supabase and verified both tables exist.
