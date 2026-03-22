---
phase: 1
slug: foundation
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Build + typecheck (scaffold phase -- no unit tests needed) |
| **Config file** | apps/voice-dashboard/package.json |
| **Quick run command** | `npm run build --workspace=apps/voice-dashboard` |
| **Full suite command** | `npm run build --workspace=apps/voice-dashboard && npm run build --workspace=apps/api` |
| **Estimated runtime** | ~30 seconds |

---

## Validation Strategy

This is a scaffold/infrastructure phase. The automated validation strategy uses **build and typecheck** rather than unit tests:

- **Build verification** (`npm run build`) confirms all TypeScript compiles, all imports resolve, and Next.js can produce a working output
- **API build verification** confirms CORS config changes in env.ts don't break the API
- **Bash syntax checks** (`bash -n`) confirm deployment scripts are syntactically valid

Unit tests (vitest) are deferred to Phase 2 when testable business logic is introduced. For Phase 1, build success is the appropriate automated verification.

---

## Sampling Rate

- **After every task commit:** Run `npm run build --workspace=apps/voice-dashboard`
- **After every plan wave:** Run full build (dashboard + API)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| scaffold | 01 | 1 | APP-01 | build | `npm run build --workspace=apps/voice-dashboard` | pending |
| cors | 01 | 1 | APP-01 | build + grep | `grep "localhost:3001" apps/api/src/config/env.ts` | pending |
| auth-lib | 02 | 2 | AUTH-01, AUTH-02, AUTH-03 | build | `npm run build --workspace=apps/voice-dashboard` | pending |
| auth-ui | 02 | 2 | AUTH-01, AUTH-02, AUTH-03 | build | `npm run build --workspace=apps/voice-dashboard` | pending |
| deploy-scripts | 03 | 2 | APP-02, APP-03 | syntax | `bash -n installation/scripts/install_voice_dashboard.sh && bash -n installation/scripts/update_voice_dashboard.sh` | pending |
| deploy-integration | 03 | 2 | APP-03 | grep | `grep "update_voice_dashboard" installation/scripts/update_all.sh` | pending |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Login redirects to dashboard | AUTH-01 | Browser UI interaction | Navigate to /login, enter admin creds, verify redirect to / |
| JWT auto-refresh on 401 | AUTH-02 | Requires expired token simulation | Manually expire token, trigger API call, verify session survives |
| Logout clears session | AUTH-03 | Browser session state | Click logout, verify /login redirect and no auth routes accessible |
| CORS passes from dashboard | APP-02 | Network-level check | Open dashboard at localhost:3001, open DevTools, verify no CORS errors on API calls |
| Nginx proxy routes correctly | APP-02 | VPS network config | Verify agent.coziyoo.com -> 127.0.0.1:3001 in Nginx Proxy Manager |
| CI/CD deploy succeeds | APP-03 | Requires push to main | Push a change, verify GitHub Actions completes and VPS service restarts |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands (build/typecheck/syntax checks)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (build/typecheck validation strategy for scaffold phase)
