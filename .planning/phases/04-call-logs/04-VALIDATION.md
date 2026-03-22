---
phase: 4
slug: call-logs
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-03-22
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for call-log persistence and dashboard log browsing.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **API framework** | Vitest (apps/api) |
| **Voice-agent framework** | pytest (apps/voice-agent) |
| **Quick API run** | `npm run test --workspace=apps/api -- --run src/routes/__tests__/livekit-session-end-logs.test.ts` |
| **Quick voice-agent run** | `cd apps/voice-agent && python -m pytest tests/test_dashboard_call_logs.py -x` |
| **Estimated runtime** | ~30-60 seconds per task verify |

---

## Sampling Rate

- After each task commit: targeted test command from that task
- After each plan: relevant workspace suite for touched area
- Before phase verify: run all new/updated call-log tests in both API and voice-agent
- Max feedback latency: 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Requirement | Test Type | Automated Command | Status |
|---------|------|-------------|-----------|-------------------|--------|
| logs-db-persist | 04-01 | LOGS-01 | API integration | `npm run test --workspace=apps/api -- --run src/routes/__tests__/livekit-session-end-logs.test.ts` | ⬜ pending |
| logs-admin-list | 04-01 | LOGS-02,03,04 | API route tests | `npm run test --workspace=apps/api -- --run src/routes/__tests__/admin-agent-call-logs.test.ts` | ⬜ pending |
| logs-dashboard-view | 04-02 | LOGS-02 | FastAPI route smoke | `cd apps/voice-agent && python -m py_compile src/voice_agent/join_api.py` | ⬜ pending |
| logs-filters-url | 04-03 | LOGS-03,04 | HTMX/URL behavior | `cd apps/voice-agent && python -m pytest tests/test_dashboard_call_logs.py -x` | ⬜ pending |

---

## Manual Verifications

| Behavior | Requirement | Why Manual | Steps |
|----------|-------------|------------|-------|
| End-to-end call appears in dashboard logs | LOGS-01, LOGS-02 | Needs running LiveKit/agent/API stack | Run voice session, end call, confirm row appears in `/dashboard/call-logs` |
| Profile/date filters persist in URL and survive refresh | LOGS-03, LOGS-04 | Browser URL state and HTMX interaction | Apply filters, verify query string updates, refresh page, confirm same filter state/table |

---

## Validation Sign-Off

- [ ] Every task includes at least one automated verify command
- [ ] Sampling continuity satisfied
- [ ] API + dashboard behavior validated for all LOGS requirements
- [ ] `nyquist_compliant: true` set at phase completion

