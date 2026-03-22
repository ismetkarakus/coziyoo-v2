---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing in apps/api) + Next.js built-in type check |
| **Config file** | apps/voice-dashboard/package.json |
| **Quick run command** | `npm run build --workspace=apps/voice-dashboard` |
| **Full suite command** | `npm run build --workspace=apps/voice-dashboard && npm run typecheck --workspace=apps/voice-dashboard` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run build --workspace=apps/voice-dashboard`
- **After every plan wave:** Run full build + typecheck
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| scaffold | 01 | 1 | APP-01 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| auth-lib | 01 | 1 | AUTH-01, AUTH-02, AUTH-03 | typecheck | `npm run typecheck --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| cors | 01 | 1 | APP-02 | manual | curl test from dashboard origin | ✅ | ⬜ pending |
| deploy | 01 | 2 | APP-02, APP-03 | manual | SSH to VPS and verify service up | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/voice-dashboard/` — Next.js workspace created with `next.config.ts`, `package.json`, `tsconfig.json`
- [ ] `apps/voice-dashboard/src/lib/api.ts` — auth API wrapper (ported from admin panel)
- [ ] `apps/voice-dashboard/src/lib/auth.ts` — token storage helpers (ported from admin panel)

*Wave 0 installs the scaffold before any feature tasks run.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Login redirects to dashboard | AUTH-01 | Browser UI interaction | Navigate to /login, enter admin creds, verify redirect to / |
| JWT auto-refresh on 401 | AUTH-02 | Requires expired token simulation | Manually expire token, trigger API call, verify session survives |
| Logout clears session | AUTH-03 | Browser session state | Click logout, verify /login redirect and no auth routes accessible |
| CORS passes from dashboard | APP-02 | Network-level check | Open dashboard at localhost:3001, open DevTools, verify no CORS errors on API calls |
| CI/CD deploy succeeds | APP-03 | Requires push to main | Push a change, verify GitHub Actions completes and VPS service restarts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
