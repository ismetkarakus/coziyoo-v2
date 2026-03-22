# Technology Stack

**Project:** Voice Agent Dashboard (apps/voice-dashboard)
**Researched:** 2026-03-22

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Next.js | 16.2.x | App framework | Latest stable (16.2.1 released 2026-03-21). App Router is the default architecture. Turbopack is the default bundler for both dev and build. React Compiler is built-in and stable. Requires Node.js 20+ which the monorepo already enforces. | HIGH |
| React | 19.x | UI library | Ships with Next.js 16. The existing admin panel uses React 18, but this is a separate workspace -- use the Next.js 16 default. React Compiler eliminates manual useMemo/useCallback. | HIGH |
| TypeScript | 5.9.x | Type safety | Match monorepo version (5.9.3). Strict mode enabled per existing conventions. Next.js 16 has first-class TS support. | HIGH |

**App Router, not Pages Router.** The App Router is the standard in 2026. Server Components reduce client bundle for config-heavy pages. File-based routing with layouts maps perfectly to a dashboard with a persistent sidebar. The existing admin panel uses React Router -- this dashboard benefits from Next.js conventions instead.

### Styling and UI Components

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Tailwind CSS | 4.x | Utility CSS | CSS-first config -- no tailwind.config.js needed. 5x faster builds than v3. Next.js 16 has first-class support (`create-next-app --tailwind`). Required by shadcn/ui. | HIGH |
| shadcn/ui | latest (CLI v4) | Component library | Not a dependency -- copies component source into the project. Full ownership of code. Radix UI primitives underneath. The vapi.ai-inspired tabbed layout (Model/Voice/Transcriber/Tools) maps directly to shadcn Tabs + Card components. Includes sidebar, data table, form, dialog -- everything this dashboard needs. | HIGH |
| Sonner | 2.x | Toast notifications | shadcn/ui's official toast solution. One-line API: `toast.success("Profile saved")`. | HIGH |
| Lucide React | latest | Icons | Default icon set for shadcn/ui. Tree-shakeable. | HIGH |

### Data Fetching and State

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @tanstack/react-query | 5.x | Server state / caching | Handles fetching, caching, background refetch, optimistic updates, loading/error states. Profile CRUD and call log listing are classic query/mutation patterns. Works with App Router via HydrationBoundary for SSR prefetch. | HIGH |
| nuqs | 2.x | URL state for filters | Type-safe `useQueryState` hook. Call log filters (date range, profile ID, status) and active tab state belong in the URL so they survive refresh and are shareable. 6 kB. Built for Next.js App Router. | MEDIUM |

**No Redux, no Zustand, no global state library.** This is a config dashboard with CRUD forms and a data table. TanStack Query handles all server state. Local `useState` handles UI state. Auth tokens live in sessionStorage. A global store would have nothing to manage.

### Forms and Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| React Hook Form | 7.x | Form state management | Uncontrolled components = minimal re-renders. The profile config form has 4 tabs with 15+ fields across LLM, STT, TTS, and tools sections. RHF handles complex nested forms without performance issues. | HIGH |
| Zod | 4.x | Schema validation | Already used in the API (4.3.6) for env and request validation. Share profile validation schemas between dashboard and API via `@coziyoo/shared-types`. Single source of truth for profile shape. | HIGH |
| @hookform/resolvers | latest | RHF + Zod bridge | Connects Zod schemas to React Hook Form. One-line setup: `resolver: zodResolver(profileSchema)`. | HIGH |

### Data Display

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @tanstack/react-table | 8.x | Call logs table | Headless table library. Combined with shadcn/ui DataTable component for sorting, filtering, pagination. Call logs will be under 10K rows -- no need for AG Grid's virtualization. | HIGH |

### Authentication

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Custom JWT wrapper | N/A | Admin auth | Reuse the existing admin JWT realm (ADMIN_JWT_SECRET). Same pattern as apps/admin. | HIGH |

**Auth implementation -- reuse the existing admin panel pattern exactly:**

The existing admin panel (`apps/admin/src/lib/auth.ts` and `apps/admin/src/lib/api.ts`) implements:
1. Login page calls `POST /v1/admin/auth/login` on the Express API
2. Access + refresh tokens stored in **sessionStorage** (not cookies, not localStorage)
3. Every API call attaches `Authorization: Bearer <accessToken>` header
4. On 401 response, auto-refresh via `POST /v1/admin/auth/refresh` with serialized retry (prevents multiple concurrent refresh calls)
5. Client-side auth guard redirects to login when no tokens present

**Copy this pattern verbatim for the voice dashboard.** The `request()` wrapper and token storage helpers from `apps/admin/src/lib/api.ts` can be adapted with minimal changes (replace `import.meta.env.VITE_API_BASE_URL` with `process.env.NEXT_PUBLIC_API_BASE_URL`).

**No `jose` or server-side JWT verification needed.** The dashboard pages are client-rendered. Auth is enforced by the Express API on every request -- the dashboard is just a client that sends tokens. A Next.js middleware auth check is defense-in-depth but not required for an internal tool. If added later, use `jose` (edge-compatible JWT lib) in `middleware.ts`.

**Not NextAuth/Auth.js.** The Express API already has admin auth endpoints with session management, audit logging, and presence tracking. NextAuth would mean maintaining two auth systems.

### Development Tools

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @tanstack/react-query-devtools | 5.x | Query debugging | Visual cache inspector during development. Critical for debugging stale data in profile switching. | HIGH |
| ESLint + eslint-config-next | latest | Linting | Ships with `create-next-app`. Enforces Next.js-specific best practices. | HIGH |
| Turbopack | built-in | Dev bundler | Default in Next.js 16. No config needed. ~400% faster dev startup. | HIGH |

### Build and Deployment

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Next.js standalone output | -- | Production build | `output: 'standalone'` in next.config produces a self-contained Node.js server (~15 MB). Deploy with `node .next/standalone/server.js`. Fits the existing systemd pattern (coziyoo-api, coziyoo-admin). | HIGH |

## What NOT to Use

| Technology | Why Not | What Instead |
|------------|---------|--------------|
| NextAuth / Auth.js | Over-engineered for single JWT shared secret. Adds OAuth/session DB complexity. The admin panel proves the custom wrapper works. | Custom fetch wrapper + sessionStorage |
| Prisma / Drizzle ORM | Dashboard does NOT talk to DB directly. All data flows through the Express API. Adding an ORM creates a second data access layer. | HTTP fetch to Express API |
| Next.js Server Actions for mutations | The Express API is the single backend. Server Actions would bypass API routes and duplicate business logic. | TanStack Query mutations calling REST endpoints |
| tRPC | Requires tRPC on both client and server. The API is REST. | Typed fetch with Zod response parsing |
| Redux / Zustand / Jotai | No complex client state. TanStack Query handles server cache. Auth lives in sessionStorage. | TanStack Query + useState |
| Material UI / Ant Design / Chakra | Heavy, opinionated, hard to customize, fight Tailwind. | shadcn/ui (own the code) |
| Styled Components / CSS Modules | Tailwind v4 is the standard for Next.js + shadcn/ui. | Tailwind CSS v4 |
| AG Grid | Enterprise license for a call log table under 10K rows. | TanStack Table + shadcn DataTable |
| Conform | Built for progressive enhancement with Server Actions. We need client-side forms hitting a REST API. | React Hook Form |
| Turborepo | Monorepo has 3-4 apps. npm workspaces handles this scale. Turborepo adds build system complexity without meaningful benefit. | npm workspaces (existing) |
| Storybook | Internal tool, single team, shadcn components documented upstream. Build overhead not justified. | -- |
| next-intl / i18n | Internal ops tool used by one team. English only. | -- |

## Monorepo Integration

### Directory structure

```
coziyoo-v2/
  apps/
    api/                # Express/TS (existing)
    admin/              # React/Vite (existing)
    voice-dashboard/    # Next.js (new)
    mobile/             # Expo (existing, not in workspaces)
    voice-agent/        # Python (not in workspaces)
  packages/
    shared-types/       # TypeScript types (existing)
    shared-utils/       # Utilities (existing)
```

### Root package.json changes

Add `"apps/voice-dashboard"` to the workspaces array:

```json
{
  "workspaces": [
    "apps/api",
    "apps/admin",
    "apps/voice-dashboard",
    "packages/*"
  ]
}
```

Add convenience scripts:

```json
{
  "dev:voice-dashboard": "npm run dev --workspace=apps/voice-dashboard",
  "build:voice-dashboard": "npm run build --workspace=apps/voice-dashboard"
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
    "test": "vitest run"
  }
}
```

**Port 3001** avoids collision with the Express API on port 3000 and the admin panel on port 5174.

### Shared types

Import from `@coziyoo/shared-types` for types shared with the API. Add voice profile types there so both `apps/api` and `apps/voice-dashboard` stay in sync. Configure `transpilePackages: ['@coziyoo/shared-types', '@coziyoo/shared-utils']` in `next.config.ts`.

## Installation

```bash
# 1. Scaffold the workspace (from monorepo root)
cd apps
npx create-next-app@latest voice-dashboard --typescript --tailwind --eslint --app --src-dir --no-import-alias

# 2. Add workspace to root package.json workspaces array, then:
cd ..
npm install

# 3. Add runtime dependencies
npm install @tanstack/react-query @tanstack/react-table react-hook-form @hookform/resolvers zod nuqs sonner --workspace=apps/voice-dashboard

# 4. Add dev dependencies
npm install -D @tanstack/react-query-devtools vitest @testing-library/react --workspace=apps/voice-dashboard

# 5. Initialize shadcn/ui (from inside app directory)
cd apps/voice-dashboard
npx shadcn@latest init
npx shadcn@latest add button card dialog form input label select separator sheet sidebar tabs table toast badge
```

## Environment Variables

```env
# Client-side (exposed to browser)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000

# Server-side only (for optional middleware JWT verification)
ADMIN_JWT_SECRET=<same value as root .env>
```

In development, use `next.config.ts` rewrites to proxy `/v1/*` to `http://localhost:3000/v1/*` to avoid CORS issues, matching the existing admin panel's Vite proxy pattern.

In production, set `NEXT_PUBLIC_API_BASE_URL=https://api.coziyoo.com` and add `https://agent.coziyoo.com` to `CORS_ALLOWED_ORIGINS` in the root `.env`.

## Production Deployment

### Systemd service

```ini
[Unit]
Description=Coziyoo Voice Dashboard
After=network.target

[Service]
Type=simple
User=coziyoo
WorkingDirectory=/opt/coziyoo/apps/voice-dashboard
ExecStart=/usr/bin/node .next/standalone/server.js
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_BASE_URL=https://api.coziyoo.com
Restart=always

[Install]
WantedBy=multi-user.target
```

### Nginx Proxy Manager

Add route: `agent.coziyoo.com` -> `127.0.0.1:3001`

## Version Compatibility Matrix

| Package | Version | Requires | Notes |
|---------|---------|----------|-------|
| Next.js 16.2 | 16.2.x | React 19, Node 20+ | Turbopack default for dev and build |
| React 19 | 19.x | -- | React Compiler stable |
| Tailwind CSS 4 | 4.x | PostCSS (auto-configured) | CSS-first, no config file |
| shadcn/ui CLI v4 | latest | Tailwind v4, React 19 | Supports Radix + Base UI variants |
| TanStack Query 5 | 5.x | React 18+ | SSR via HydrationBoundary |
| TanStack Table 8 | 8.x | React 18+ | Headless, pairs with shadcn DataTable |
| React Hook Form 7 | 7.x | React 18+ | Uncontrolled components |
| Zod 4 | 4.x | -- | Matches API workspace version |
| nuqs 2 | 2.x | Next.js 14.2+ | App Router adapter built-in |
| Sonner 2 | 2.x | React 18+ | shadcn/ui toast default |

## Sources

- [Next.js 16 release blog](https://nextjs.org/blog/next-16) -- HIGH confidence
- [Next.js 16.2 release blog](https://nextjs.org/blog/next-16-2) -- HIGH confidence, latest stable
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) -- HIGH confidence
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) -- HIGH confidence
- [shadcn/cli v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) -- HIGH confidence
- [TanStack Query Advanced SSR guide](https://tanstack.com/query/v5/docs/react/guides/advanced-ssr) -- HIGH confidence
- [nuqs - Type-safe search params](https://nuqs.dev) -- HIGH confidence
- [Tailwind CSS v4 announcement](https://tailwindcss.com/blog/tailwindcss-v4) -- HIGH confidence
- [Tailwind CSS Next.js guide](https://tailwindcss.com/docs/guides/nextjs) -- HIGH confidence
- Existing codebase: `apps/admin/src/lib/api.ts` and `apps/admin/src/lib/auth.ts` -- HIGH confidence (source of truth for auth pattern)

---

*Stack research: 2026-03-22*
