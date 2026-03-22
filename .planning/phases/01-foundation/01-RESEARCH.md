# Phase 1: Foundation - Research

**Researched:** 2026-03-22
**Domain:** Next.js workspace scaffolding, admin JWT auth integration, CORS configuration, CI/CD deployment pipeline
**Confidence:** HIGH

## Summary

Phase 1 creates the `apps/voice-dashboard` Next.js workspace, implements admin JWT authentication (porting the existing pattern from `apps/admin`), configures CORS for the new origin, and integrates the dashboard into the existing CI/CD deployment pipeline. No new API routes or database tables are needed in this phase -- the scope is purely: scaffold the app, make auth work, make deployment work.

The existing admin panel (`apps/admin`) provides a complete, battle-tested auth implementation in ~100 lines across two files (`lib/api.ts` and `lib/auth.ts`). The voice dashboard ports this pattern to Next.js with minimal adaptation: replace `import.meta.env.VITE_API_BASE_URL` with `process.env.NEXT_PUBLIC_API_BASE_URL`, keep sessionStorage for token persistence, keep the serialized refresh-on-401 pattern. The API already has all necessary auth endpoints (`/v1/admin/auth/login`, `/refresh`, `/logout`, `/me`) -- zero backend changes for auth.

The deployment infrastructure follows established patterns: the API service uses a systemd unit with `EnvironmentFile` pointing to root `.env`; the admin panel builds static files served by `npx serve`. The voice dashboard will use Next.js standalone output mode (`output: 'standalone'` in `next.config.ts`), running as a Node.js process on port 3001 behind Nginx Proxy Manager at `agent.coziyoo.com`. This requires a new `update_voice_dashboard.sh` script, a new systemd service file, and additions to `update_all.sh`.

**Primary recommendation:** Port the admin panel auth pattern verbatim, use Next.js standalone output for deployment, and resolve CORS + npm workspace hoisting before writing any dashboard page code.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTH-01 | User can log in with admin credentials at agent.coziyoo.com/login | Admin auth endpoints exist (`POST /v1/admin/auth/login`). Port `apps/admin/src/lib/api.ts` and `apps/admin/src/lib/auth.ts` to Next.js. Login response shape documented below. |
| AUTH-02 | User session persists and auto-refreshes JWT on 401 | Existing `request()` wrapper in admin panel handles serialized refresh via `POST /v1/admin/auth/refresh`. Token rotation is transactional (admin-auth.ts:114-165). sessionStorage survives page refresh within tab. |
| AUTH-03 | User can log out and is redirected to login page | `POST /v1/admin/auth/logout` exists with `requireAuth("admin")`. Clears sessionStorage tokens + redirects client-side. |
| APP-01 | Dashboard runs as standalone Next.js app in npm monorepo (apps/voice-dashboard) | Next.js 16.2 with App Router. Add `"apps/voice-dashboard"` to root `package.json` workspaces. Port 3001 for dev. |
| APP-02 | Dashboard accessible at agent.coziyoo.com via Nginx proxy | Nginx Proxy Manager rule: `agent.coziyoo.com -> 127.0.0.1:3001`. Systemd service runs `node .next/standalone/server.js`. |
| APP-03 | Dashboard integrates with CI/CD pipeline (deploy on push) | New `update_voice_dashboard.sh` added to `update_all.sh`. GitHub Actions workflow unchanged -- it SSHes and runs `update_all.sh`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.x | App framework | Latest stable, App Router default, Turbopack bundler |
| React | 19.x | UI library | Ships with Next.js 16, React Compiler stable |
| TypeScript | 5.9.x | Type safety | Matches monorepo (`^5.0.0` in root, `^5.9.3` in admin) |
| Tailwind CSS | 4.x | Styling | CSS-first config, no config file needed, required by shadcn/ui |
| shadcn/ui | latest (CLI v4) | Component library | Copied source, Radix primitives, supports Tailwind v4 + React 19 |

### Supporting (Phase 1 only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Sonner | 2.x | Toast notifications | Login error feedback, logout confirmation |
| Lucide React | latest | Icons | shadcn/ui default icon set |

### Phase 1 Does NOT Need
| Library | Why Not Yet |
|---------|------------|
| TanStack Query | No data fetching beyond auth in Phase 1 |
| React Hook Form + Zod | No forms beyond login in Phase 1 (login is simple enough for useState) |
| TanStack Table | No data tables in Phase 1 |
| nuqs | No URL state management in Phase 1 |
| jose | No server-side JWT verification needed -- client-only auth pattern |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Standalone Node.js output | Static export (`output: 'export'`) | Static export is simpler (matches admin panel deployment) but prevents using Next.js middleware for auth redirects. Standalone output is more flexible and matches the Node.js systemd pattern used by the API. |
| sessionStorage | Cookies | Cookies would enable Server Component auth but add complexity. sessionStorage matches the proven admin panel pattern and is sufficient for an internal tool. |
| Custom fetch wrapper | Axios / ky | The admin panel uses raw fetch with a thin wrapper. Porting it is simpler than introducing a new HTTP library. |

**Installation:**
```bash
# From monorepo root
cd apps
npx create-next-app@latest voice-dashboard --typescript --tailwind --eslint --app --src-dir --no-import-alias
cd ..
npm install

# Add shadcn/ui
cd apps/voice-dashboard
npx shadcn@latest init
npx shadcn@latest add button card input label sonner
```

## Architecture Patterns

### Project Structure (Phase 1 scope only)
```
apps/voice-dashboard/
  package.json
  next.config.ts
  tsconfig.json
  .env.local                    # NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
  src/
    app/
      layout.tsx                # Root layout: sidebar shell (placeholder for Phase 2)
      page.tsx                  # Redirect to /login or /dashboard
      login/
        page.tsx                # Login form (client component)
      (dashboard)/
        layout.tsx              # Authenticated layout with sidebar
        page.tsx                # Dashboard home (placeholder)
    lib/
      api.ts                    # HTTP client with JWT auto-refresh (ported from admin)
      auth.ts                   # Token storage helpers (ported from admin)
      types.ts                  # AdminUser, Tokens, ApiError types
    components/
      auth-guard.tsx            # Client component: redirects to /login if no tokens
    middleware.ts               # Next.js middleware: redirect unauthenticated to /login
```

### Pattern 1: API Client with JWT Auto-Refresh
**What:** Port the admin panel's `request()` wrapper verbatim
**When to use:** Every API call from the dashboard
**Source:** `apps/admin/src/lib/api.ts` (58 lines, fully verified)

```typescript
// apps/voice-dashboard/src/lib/api.ts
// Key differences from admin panel:
// 1. API_BASE uses process.env.NEXT_PUBLIC_API_BASE_URL (not import.meta.env.VITE_API_BASE_URL)
// 2. Everything else is identical

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

let refreshInFlight: Promise<boolean> | null = null;

export async function request(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const tokens = getTokens();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("content-type") && init?.body) {
    headers.set("content-type", "application/json");
  }
  if (tokens?.accessToken) {
    headers.set("authorization", `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (response.status === 401 && retry && tokens?.refreshToken) {
    const refreshed = await refreshTokenSerialized(tokens.refreshToken);
    if (refreshed) {
      return request(path, init, false);
    }
  }

  return response;
}
```

### Pattern 2: Token Storage in sessionStorage
**What:** Port `apps/admin/src/lib/auth.ts` (42 lines)
**Why sessionStorage:** Tokens clear on tab close (security), persist across page refreshes within a session, and each app maintains independent token chains (avoids Pitfall 2 -- JWT refresh race condition between admin and dashboard).

```typescript
// apps/voice-dashboard/src/lib/auth.ts
// Use a different storage key to avoid collision with admin panel
const TOKEN_KEY = "coziyoo_dashboard_tokens";  // NOT "coziyoo_admin_tokens"
const ADMIN_KEY = "coziyoo_dashboard_me";
```

### Pattern 3: Auth Guard for Protected Routes
**What:** Client component that checks for tokens and redirects to /login
**When:** Wraps the `(dashboard)` layout

```typescript
// Two-layer auth:
// 1. middleware.ts checks for token cookie/header and redirects (fast, edge-level)
// 2. AuthGuard client component validates tokens are present in sessionStorage
//    and redirects to /login if missing (handles expired sessions)
```

### Pattern 4: Next.js Middleware for Auth Redirect
**What:** `middleware.ts` at `src/` root checks if user is authenticated
**Limitation:** Since tokens are in sessionStorage (not cookies), middleware cannot verify them server-side. Middleware can only redirect if there's no indication of auth. The real auth check happens client-side in the AuthGuard component.
**Decision:** Use a lightweight middleware that protects `/dashboard/*` routes by checking for a session indicator cookie (set client-side on login, cleared on logout). This is defense-in-depth, not the primary auth mechanism.

### Anti-Patterns to Avoid
- **Direct database access from Next.js:** All data flows through the Express API via HTTP. Never import `pg` in the dashboard.
- **Server Actions for auth:** The Express API handles auth. Do not create Next.js API routes or Server Actions for login/refresh/logout.
- **Shared token storage between apps:** Use different sessionStorage keys for admin panel and dashboard to avoid the refresh token race condition (Pitfall 2).
- **Server Component data fetching with auth:** Auth tokens live in sessionStorage (browser-only). Server Components cannot access them. All authenticated data fetching must happen in Client Components.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT auto-refresh | Custom retry logic | Port `apps/admin/src/lib/api.ts` `request()` wrapper | Serialized refresh prevents concurrent refresh calls; proven pattern |
| Auth redirect | Custom route guards | Next.js `middleware.ts` + client AuthGuard | Two-layer defense: middleware for fast redirect, client guard for token validation |
| Toast notifications | Custom toast component | Sonner (shadcn/ui default) | One-line API, accessible, animated |
| Static file serving (prod) | Nginx serving `.next/` | Next.js `output: 'standalone'` with `node server.js` | Standalone output handles all Next.js routing (SPA fallback, middleware, etc.) |
| Deployment script | Manual SSH commands | New `update_voice_dashboard.sh` following `update_admin_panel.sh` pattern | Consistent with existing infra, called by `update_all.sh` |

## Common Pitfalls

### Pitfall 1: CORS Rejection on First API Call
**What goes wrong:** Dashboard at `http://localhost:3001` (dev) or `https://agent.coziyoo.com` (prod) sends requests to the API, but the origin is not in `CORS_ALLOWED_ORIGINS`.
**Current state:** Production `.env` and `.env.local` already include `https://agent.coziyoo.com` and `http://agent.coziyoo.com`. However:
- `env.ts:21` defaults to `http://localhost:8081,http://localhost:5173,http://localhost:19006` -- missing `http://localhost:3001`
- `.env.example:11` defaults to `http://localhost:5173,http://localhost:8081,http://localhost:19006` -- missing localhost:3001 and agent.coziyoo.com
- `common.sh:246` CORS default does not include `agent.coziyoo.com`
**How to avoid:**
1. Add `http://localhost:3001` to the default in `env.ts:21`
2. Add `http://localhost:3001,https://agent.coziyoo.com` to `.env.example`
3. Add `https://${VOICE_DASHBOARD_DOMAIN:-agent.coziyoo.com}` to `common.sh:246` CORS default
**Warning signs:** Browser DevTools shows `blocked by CORS policy` on preflight OPTIONS. API logs show 204 to OPTIONS but no subsequent request.

### Pitfall 2: npm Workspace Hoisting Conflicts
**What goes wrong:** Admin panel uses React 18.3.x. Next.js 16.2 ships React 19.x. npm hoists one version, the other gets a symlink, causing "Invalid hook call" errors.
**How to avoid:**
1. Let Next.js use React 19 (its requirement). Admin panel stays on React 18.
2. npm workspaces handles this correctly by default -- each workspace gets its own React if versions differ
3. Test with `rm -rf node_modules package-lock.json && npm install` after adding the workspace
4. If conflicts arise, add `overrides` in root `package.json` or use `--legacy-peer-deps`
**Warning signs:** `npm install` emits `ERESOLVE` warnings. Runtime: "Invalid hook call" or "Cannot read properties of null (reading 'useState')".

### Pitfall 3: Standalone Output Missing Static Assets
**What goes wrong:** `output: 'standalone'` produces a minimal server.js but does NOT copy the `public/` folder or `.next/static/` into the standalone directory. The deployed app serves pages but CSS/JS assets return 404.
**How to avoid:** The deployment script must copy static assets after build:
```bash
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
```
**Source:** This is a well-documented Next.js requirement for standalone builds.

### Pitfall 4: sessionStorage Tokens Not Available in Next.js Middleware
**What goes wrong:** Developer tries to read JWT from sessionStorage in `middleware.ts` to verify auth server-side. Middleware runs on the edge/server -- sessionStorage does not exist.
**How to avoid:** Use a lightweight session indicator cookie (set on login, cleared on logout) for middleware redirect decisions. The real auth check is client-side in AuthGuard. For an internal tool, this is sufficient.

### Pitfall 5: Forgetting to Add Dashboard to CI/CD Pipeline
**What goes wrong:** Push to main deploys API and admin but not the dashboard. Dashboard serves stale code.
**How to avoid:**
1. Create `installation/scripts/update_voice_dashboard.sh` (modeled on `update_admin_panel.sh`)
2. Add call to it in `update_all.sh` between admin and voice-agent updates
3. Create `installation/scripts/install_voice_dashboard.sh` for first-time VPS setup

## Code Examples

### Admin Auth API Response Shapes (verified from admin-auth.ts)

**Login Response** (`POST /v1/admin/auth/login`):
```json
{
  "data": {
    "admin": { "id": "uuid", "email": "admin@coziyoo.com", "role": "admin" },
    "tokens": { "accessToken": "jwt...", "refreshToken": "token...", "tokenType": "Bearer" }
  }
}
```

**Refresh Response** (`POST /v1/admin/auth/refresh`):
```json
{
  "data": {
    "tokens": { "accessToken": "jwt...", "refreshToken": "token...", "tokenType": "Bearer" }
  }
}
```

**Logout Response** (`POST /v1/admin/auth/logout`, requires Bearer token):
```json
{ "data": { "success": true } }
```

**Me Response** (`GET /v1/admin/auth/me`, requires Bearer token):
```json
{ "data": { "id": "uuid", "email": "admin@coziyoo.com", "role": "admin", "last_login_at": "2026-03-22T..." } }
```

**Error Response** (all endpoints):
```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "Email or password invalid" } }
```

### next.config.ts (Phase 1)
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@coziyoo/shared-types", "@coziyoo/shared-utils"],
  async rewrites() {
    // Dev proxy to avoid CORS in development (matches admin panel's Vite proxy pattern)
    return [
      {
        source: "/v1/:path*",
        destination: "http://localhost:3000/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
```

### Systemd Service File (for installation script)
```ini
[Unit]
Description=Coziyoo Voice Dashboard (Next.js)
After=network.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_GROUP}
WorkingDirectory=${DASHBOARD_DIR_ABS}/.next/standalone
ExecStart=/bin/bash -lc 'cd "${DASHBOARD_DIR_ABS}/.next/standalone" && exec node server.js'
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_BASE_URL=https://api.coziyoo.com
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### update_voice_dashboard.sh (deployment script pattern)
```bash
#!/usr/bin/env bash
set -euo pipefail
# Follows update_admin_panel.sh pattern:
# 1. Source common.sh + load_config
# 2. Set vars: DASHBOARD_DIR_ABS, SERVICE_NAME, API_BASE_URL
# 3. maybe_git_update
# 4. npm install (from workspace root)
# 5. Create .env.production.local with NEXT_PUBLIC_API_BASE_URL
# 6. npm run build --workspace=apps/voice-dashboard
# 7. Copy static assets into standalone dir
# 8. service_action restart
```

### Root package.json Changes
```json
{
  "workspaces": [
    "apps/api",
    "apps/admin",
    "apps/voice-dashboard",
    "packages/*"
  ],
  "scripts": {
    "dev:voice-dashboard": "npm run dev --workspace=apps/voice-dashboard",
    "build:voice-dashboard": "npm run build --workspace=apps/voice-dashboard"
  }
}
```

### Workspace package.json
```json
{
  "name": "@coziyoo/voice-dashboard",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev --turbopack --port 3001",
    "build": "next build",
    "start": "node .next/standalone/server.js",
    "test": "echo \"No tests yet\""
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Pages Router | App Router (default) | Next.js 13+ (2023), standard by 16 | File-based layouts, Server/Client Components, middleware.ts |
| Tailwind v3 (config file) | Tailwind v4 (CSS-first) | 2025 | No tailwind.config.js needed, 5x faster builds |
| Webpack | Turbopack (default) | Next.js 16 (2026) | Faster dev and build, no config needed |
| Manual useMemo/useCallback | React Compiler (automatic) | React 19 + Next.js 16 | No manual memoization needed |
| Admin panel uses React 18 | New dashboard uses React 19 | Now | Different versions OK in separate workspaces |

## Open Questions

1. **Dev proxy vs direct CORS for local development**
   - What we know: Admin panel uses Vite proxy (`/v1 -> localhost:3000`). Next.js supports `rewrites` in `next.config.ts` for the same purpose.
   - What's unclear: Whether to use rewrites (avoids CORS entirely in dev) or direct cross-origin calls with CORS configured (matches production behavior).
   - Recommendation: Use rewrites for dev (simpler, matches admin panel pattern), direct calls in production. Add localhost:3001 to CORS defaults anyway as a safety net.

2. **Session indicator cookie for middleware**
   - What we know: sessionStorage tokens are browser-only, invisible to middleware.
   - What's unclear: Whether to add a non-sensitive session indicator cookie for middleware redirect, or skip middleware entirely and rely only on client-side AuthGuard.
   - Recommendation: Start with client-side AuthGuard only. Add middleware cookie later if the flash of login redirect is noticeable. For an internal tool with few users, this is not a priority.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (matches apps/api) |
| Config file | None -- Wave 0 |
| Quick run command | `npm run test --workspace=apps/voice-dashboard` |
| Full suite command | `npm run test --workspace=apps/voice-dashboard` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Login form calls API, stores tokens, redirects to dashboard | integration | `npm run test --workspace=apps/voice-dashboard -- --run src/lib/__tests__/auth.test.ts` | Wave 0 |
| AUTH-02 | Request wrapper auto-refreshes on 401 | unit | `npm run test --workspace=apps/voice-dashboard -- --run src/lib/__tests__/api.test.ts` | Wave 0 |
| AUTH-03 | Logout clears tokens and redirects | unit | `npm run test --workspace=apps/voice-dashboard -- --run src/lib/__tests__/auth.test.ts` | Wave 0 |
| APP-01 | Next.js app builds without errors | smoke | `npm run build --workspace=apps/voice-dashboard` | N/A (build command) |
| APP-02 | Nginx proxy routes to dashboard | manual-only | Manual: `curl -I https://agent.coziyoo.com` | N/A |
| APP-03 | CI/CD deploys dashboard on push | manual-only | Manual: push to main, verify service running | N/A |

### Sampling Rate
- **Per task commit:** `npm run build --workspace=apps/voice-dashboard`
- **Per wave merge:** `npm run test --workspace=apps/voice-dashboard && npm run build --workspace=apps/voice-dashboard`
- **Phase gate:** Full build + test green, login flow manually verified against running API

### Wave 0 Gaps
- [ ] `apps/voice-dashboard/vitest.config.ts` -- test framework config
- [ ] `apps/voice-dashboard/src/lib/__tests__/api.test.ts` -- covers AUTH-02 (request wrapper refresh logic)
- [ ] `apps/voice-dashboard/src/lib/__tests__/auth.test.ts` -- covers AUTH-01, AUTH-03 (token storage, login/logout)
- [ ] Vitest + jsdom install: `npm install -D vitest @testing-library/react jsdom --workspace=apps/voice-dashboard`

## Sources

### Primary (HIGH confidence)
- `apps/admin/src/lib/api.ts` -- complete auth request wrapper (58 lines, read in full)
- `apps/admin/src/lib/auth.ts` -- token storage helpers (42 lines, read in full)
- `apps/admin/src/types/core.ts` -- AdminUser, Tokens, ApiError types
- `apps/api/src/routes/admin-auth.ts` -- login/refresh/logout/me endpoints (266 lines, read in full)
- `apps/api/src/config/env.ts` -- CORS_ALLOWED_ORIGINS default at line 21
- `apps/api/src/app.ts` -- CORS middleware implementation (lines 35-81)
- `apps/admin/vite.config.ts` -- dev proxy pattern (`/v1 -> localhost:3000`)
- `apps/admin/package.json` -- React 18.3.x, Vite 5, TypeScript 5.9.3
- `package.json` (root) -- workspace config, scripts, Node.js >=20
- `installation/scripts/update_all.sh` -- deployment orchestration
- `installation/scripts/update_admin_panel.sh` -- admin build + deploy pattern (60 lines)
- `installation/scripts/install_api_service.sh` -- systemd service creation pattern
- `installation/scripts/install_admin_panel.sh` -- admin systemd service (serve static on port 8000)
- `.github/workflows/deploy-on-push.yml` -- CI/CD: SSH to VPS, run update_all.sh
- `.env` / `.env.local` -- current CORS origins (already include agent.coziyoo.com)
- `.env.example` -- CORS defaults (missing agent.coziyoo.com and localhost:3001)
- `installation/scripts/common.sh:246` -- CORS default generation (missing agent.coziyoo.com)

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` -- Next.js 16.2, shadcn/ui, Tailwind v4 version matrix
- `.planning/research/PITFALLS.md` -- CORS, hoisting, deployment pitfalls
- `.planning/research/ARCHITECTURE.md` -- system architecture, auth flow

### Tertiary (LOW confidence)
- N/A -- all findings verified from existing codebase files

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Next.js 16.2 version confirmed from prior research; admin panel source code read directly
- Architecture: HIGH -- Auth flow traced end-to-end through admin-auth.ts; deployment scripts read in full
- Pitfalls: HIGH -- CORS defaults verified in env.ts:21, .env.example:11, common.sh:246; each pitfall grounded in specific file/line

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain -- auth patterns and deployment scripts change infrequently)
