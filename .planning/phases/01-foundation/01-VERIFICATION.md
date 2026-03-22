---
phase: 01-foundation
verified: 2026-03-22T13:51:04Z
status: gaps_found
score: 1/5 must-haves verified
gaps:
  - truth: "User can navigate to agent.coziyoo.com/login, enter admin credentials, and land on an authenticated dashboard shell"
    status: failed
    reason: "Root route is hard-redirected to /login, so login success cannot land on dashboard shell."
    artifacts:
      - path: "apps/voice-dashboard/src/app/page.tsx"
        issue: "Unconditional redirect('/login') overrides authenticated landing."
      - path: "apps/voice-dashboard/src/app/(dashboard)/page.tsx"
        issue: "Dashboard page exists but is not reachable as post-login landing."
    missing:
      - "Route authenticated users from /login to a reachable protected dashboard path."
      - "Remove/replace unconditional root redirect or move dashboard to explicit path (e.g. /dashboard) and push there after login."
  - truth: "User can log out and is redirected to login page, with no authenticated routes accessible"
    status: failed
    reason: "Logout UI exists only in dashboard page, but dashboard shell is not reachable due root routing issue."
    artifacts:
      - path: "apps/voice-dashboard/src/app/(dashboard)/page.tsx"
        issue: "Logout handler is implemented but effectively unreachable in current routing."
    missing:
      - "Restore reachable authenticated dashboard route so user can trigger logout from UI."
  - truth: "API accepts requests from dashboard origin without CORS errors (localhost dev and production domain)"
    status: partial
    reason: "Production origin is present in .env.example and deploy defaults, but missing from API schema fallback default string."
    artifacts:
      - path: "apps/api/src/config/env.ts"
        issue: "CORS default includes localhost:3001 but not https://agent.coziyoo.com."
    missing:
      - "Align env schema fallback default with production dashboard origin, or document/enforce env requirement so fallback is never used."
---

# Phase 01: Foundation Verification Report

**Phase Goal:** The dashboard app exists, authenticates users, and is deployable -- all infrastructure is in place before feature development begins  
**Verified:** 2026-03-22T13:51:04Z  
**Status:** gaps_found  
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | User can navigate to `agent.coziyoo.com/login`, enter admin credentials, and land on authenticated dashboard shell | ✗ FAILED | Login POST is wired ([login/page.tsx](apps/voice-dashboard/src/app/login/page.tsx) lines 27-47), but root always redirects to `/login` ([app/page.tsx](apps/voice-dashboard/src/app/page.tsx) lines 1-5). Runtime check: `GET /` returns `307 Location: /login`. |
| 2 | User session survives refresh and auto-refreshes expired JWTs | ✓ VERIFIED | Session storage helpers exist ([auth.ts](apps/voice-dashboard/src/lib/auth.ts) lines 3-40). Serialized refresh on 401 exists ([api.ts](apps/voice-dashboard/src/lib/api.ts) lines 19-36, 38-57). |
| 3 | User can log out and is redirected to login page, with no authenticated routes accessible | ✗ FAILED | Logout logic exists ([api.ts](apps/voice-dashboard/src/lib/api.ts) lines 59-65; [(dashboard)/page.tsx](apps/voice-dashboard/src/app/(dashboard)/page.tsx) lines 18-21), but dashboard page is not reachable as landing route. |
| 4 | Dashboard builds and deploys via existing CI/CD pipeline | ? UNCERTAIN | Build passes (`npm run build --workspace=apps/voice-dashboard`). Workflow calls `bash installation/scripts/update_all.sh` ([deploy-on-push.yml](.github/workflows/deploy-on-push.yml) line 168), and `update_all.sh` calls `update_voice_dashboard.sh` (line 34). Live VPS execution not verifiable programmatically. |
| 5 | API accepts dashboard origin without CORS errors (dev + production) | ? UNCERTAIN | Dev/prod origins present in `.env.example` (line 11) and deploy default generation in [common.sh](installation/scripts/common.sh) lines 246-254; API schema fallback in [env.ts](apps/api/src/config/env.ts) line 21 lacks `https://agent.coziyoo.com`. |

**Score:** 1/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/voice-dashboard/package.json` | Next workspace + `--port 3001` | ✓ VERIFIED | Name and script present (lines 2, 6). |
| `apps/voice-dashboard/next.config.ts` | Standalone output + API rewrite | ✓ VERIFIED | `output: "standalone"` and `/v1` rewrite present (lines 4-11). |
| `apps/voice-dashboard/src/lib/types.ts` | AdminUser/Tokens/ApiError types | ✓ VERIFIED | All three exported. |
| `apps/voice-dashboard/src/lib/api.ts` | Request + serialized refresh | ✓ VERIFIED | 66 lines; refresh + retry wired. |
| `apps/voice-dashboard/src/lib/auth.ts` | Session storage token/admin helpers | ✓ VERIFIED | 40 lines; dashboard-scoped keys used. |
| `apps/voice-dashboard/src/app/login/page.tsx` | Login form + API call | ✓ VERIFIED | Form submit posts to `/v1/admin/auth/login`. |
| `apps/voice-dashboard/src/components/auth-guard.tsx` | Redirect unauthenticated users | ✓ VERIFIED | Redirect to `/login` when tokens absent. |
| `apps/voice-dashboard/src/app/(dashboard)/layout.tsx` | Protected shell wrapping children | ✓ VERIFIED | Wraps with `AuthGuard`. |
| `apps/voice-dashboard/src/app/page.tsx` | Correct root routing for authenticated flow | ✗ STUB/WRONG-WIRING | Unconditional `redirect("/login")` blocks authenticated landing. |
| `installation/scripts/update_voice_dashboard.sh` | Build + restart service | ✓ VERIFIED | Builds and restarts service (lines 45, 53). |
| `installation/scripts/install_voice_dashboard.sh` | Create systemd unit | ✓ VERIFIED | Creates `coziyoo-voice-dashboard` unit (lines 40-66). |
| `installation/scripts/update_all.sh` | Calls dashboard update script | ✓ VERIFIED | Calls `update_voice_dashboard.sh` (line 34). |
| `installation/scripts/run_all.sh` | Manage `voice-dashboard` service | ✓ VERIFIED | Alias and action wiring present (lines 27, 57). |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `login/page.tsx` | `/v1/admin/auth/login` | `request()` POST | WIRED | [login/page.tsx](apps/voice-dashboard/src/app/login/page.tsx) lines 32-35 |
| `lib/api.ts` | `/v1/admin/auth/refresh` | `refreshTokenSerialized` | WIRED | [api.ts](apps/voice-dashboard/src/lib/api.ts) lines 19-23, 39-43 |
| `lib/auth.ts` | `sessionStorage` | `getTokens/setTokens/getAdmin/setAdmin` | WIRED | [auth.ts](apps/voice-dashboard/src/lib/auth.ts) lines 7-39 |
| `(dashboard)/layout.tsx` | `AuthGuard` | import + wrapper | WIRED | [(dashboard)/layout.tsx](apps/voice-dashboard/src/app/(dashboard)/layout.tsx) lines 3, 7-14 |
| `update_all.sh` | `update_voice_dashboard.sh` | script call | WIRED | [update_all.sh](installation/scripts/update_all.sh) line 34 |
| `install_voice_dashboard.sh` | `systemd` | service unit creation | WIRED | [install_voice_dashboard.sh](installation/scripts/install_voice_dashboard.sh) lines 43-62 |
| `deploy-on-push.yml` | `update_all.sh` | SSH remote command | WIRED | [deploy-on-push.yml](.github/workflows/deploy-on-push.yml) line 168 |
| `login success navigation` | `reachable protected shell` | `router.push("/")` + route resolution | NOT_WIRED | `"/"` currently resolves to redirect back to `/login` ([app/page.tsx](apps/voice-dashboard/src/app/page.tsx) lines 1-5). |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| AUTH-01 | 01-02 | User can log in at `/login` and land on dashboard | ✗ BLOCKED | Login call works, but root route redirects to `/login` and blocks dashboard landing. |
| AUTH-02 | 01-02 | Session persists + auto-refresh JWT on 401 | ✓ SATISFIED | `sessionStorage` helpers + serialized refresh retry in API client. |
| AUTH-03 | 01-02 | User can log out and redirect to login | ✗ BLOCKED | Logout handler exists but dashboard route is not reachable in current root routing. |
| APP-01 | 01-01 | Standalone Next.js app in monorepo | ✓ SATISFIED | Workspace registered; build command succeeds. |
| APP-02 | 01-03 | Accessible at `agent.coziyoo.com` via Nginx | ? NEEDS HUMAN | Deploy scripts/service exist, but live domain/proxy cannot be validated from code alone. |
| APP-03 | 01-03 | Integrated with CI/CD deploy-on-push | ✓ SATISFIED | Workflow SSH command executes `installation/scripts/update_all.sh`, which updates dashboard. |

**Orphaned requirements:** None detected for Phase 1 (all expected IDs are present in plan frontmatter).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| `apps/voice-dashboard/src/app/page.tsx` | 4 | Unconditional redirect | 🛑 Blocker | Breaks authenticated post-login landing flow. |
| `apps/voice-dashboard/src/components/auth-guard.tsx` | 20 | `return null` while checking auth | ℹ️ Info | Acceptable loading gate, not a stub. |

### Human Verification Required

### 1. Production domain reachability

**Test:** Open `https://agent.coziyoo.com/login`, authenticate with valid admin credentials, then refresh page and verify shell remains accessible.  
**Expected:** Login succeeds; authenticated shell is reachable and persistent across refresh.  
**Why human:** Requires live VPS + Nginx + real credentials.

### 2. End-to-end deploy path on main push

**Test:** Push a harmless dashboard change to `main` and observe GitHub Action + server update.  
**Expected:** Workflow completes, `update_all.sh` runs remotely, `coziyoo-voice-dashboard` restarts healthy.  
**Why human:** Requires external GitHub secrets, SSH target hosts, and systemd runtime.

### Gaps Summary

Phase 01 does not currently achieve its auth goal because root routing prevents post-login access to the protected dashboard shell. This blocks AUTH-01 directly and makes AUTH-03 non-functional in real user flow. Deployment wiring and workspace/build foundations are largely in place, but live domain/deploy checks still require human validation.

---

_Verified: 2026-03-22T13:51:04Z_  
_Verifier: Claude (gsd-verifier)_
