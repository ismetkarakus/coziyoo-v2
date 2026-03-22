# Domain Pitfalls

**Domain:** Voice agent configuration dashboard integrated with existing Express API monorepo
**Researched:** 2026-03-22

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: CORS Rejection When Next.js Dashboard Calls the Express API

**What goes wrong:** The new Next.js dashboard at `agent.coziyoo.com` sends requests to `api.coziyoo.com`, but the API's CORS middleware rejects them because the origin is not in `CORS_ALLOWED_ORIGINS`. The dashboard silently fails with opaque network errors in the browser console.

**Why it happens:** The CORS origin list is managed in the root `.env` file. The current production `.env` already includes `https://agent.coziyoo.com`, but the `.env.example` and `generate_env.sh` templates do not. Fresh VPS deployments or `.env` regeneration will omit the dashboard origin. Local development (`http://localhost:3001` or whatever port Next.js uses) is also missing from the default list at `env.ts:20`.

**Consequences:** Dashboard login works (JWT is valid) but every subsequent API call returns an empty response. Developers waste hours debugging "auth issues" that are actually CORS blocks, because the browser hides the real error behind a generic `TypeError: Failed to fetch`.

**Prevention:**
1. Add the dashboard's local dev origin (e.g., `http://localhost:3001`) to the default `CORS_ALLOWED_ORIGINS` in `env.ts:20`
2. Update `generate_env.sh` and `common.sh:246` CORS defaults to include `https://agent.coziyoo.com`
3. Update `.env.example` to include the dashboard origin with a comment
4. Add a startup health-check in the dashboard that calls `GET /admin/livekit/status` and shows a clear error banner if CORS fails

**Detection:** Browser DevTools shows `blocked by CORS policy` on preflight OPTIONS request. The API access log shows 204 responses to OPTIONS but no subsequent request.

**Phase:** Must be addressed in Phase 1 (project scaffolding) before any API integration work begins.

---

### Pitfall 2: JWT Token Refresh Race Condition Between Two Frontend Apps

**What goes wrong:** Both the admin panel and the voice dashboard share the same admin JWT realm. When a user is logged into both simultaneously, one app refreshes the token (getting a new access+refresh pair), which invalidates the refresh token the other app is holding. The other app's next refresh attempt fails with 401, logging the user out unexpectedly.

**Why it happens:** The admin auth system (`admin-auth.ts`) issues a single refresh token per login. When one app calls `/admin/auth/refresh`, the old refresh token is consumed (rotated). The other app still holds the old refresh token, which is now invalid. This is standard refresh token rotation for security, but it breaks when two apps share a session.

**Consequences:** Users get randomly logged out of either the admin panel or the voice dashboard. The experience feels broken and unpredictable. Users resort to opening only one app at a time.

**Prevention:**
1. **Option A (recommended): Separate login sessions.** Each app performs its own `/admin/auth/login` call and maintains independent access+refresh token pairs. The same admin credentials work, but each app gets its own refresh token chain. This requires no backend changes.
2. **Option B: Shared storage via subdomain cookies.** Set tokens in cookies scoped to `.coziyoo.com` so both apps share the same token. This requires backend changes and introduces cookie-vs-header auth complexity.
3. Regardless of approach, the dashboard's API client must handle 401 gracefully by redirecting to login, not showing a cryptic error.

**Detection:** User reports being logged out of the admin panel after using the voice dashboard (or vice versa). Auth audit log (`admin_auth_audit`) shows `admin_login_failed` events interleaved between the two apps.

**Phase:** Phase 1 (auth integration). Must decide on Option A vs B before building the login flow.

---

### Pitfall 3: Active Profile Not Propagating to Voice Agent Sessions

**What goes wrong:** An operator marks a profile as "active" in the dashboard, but ongoing and new voice sessions continue using the old profile configuration. The operator believes the switch happened instantly, tests a call, and hears the old voice/model.

**Why it happens:** The voice agent (`entrypoint.py:1089-1100`) receives its configuration via job metadata at session start time. The metadata is set by the API when dispatching the agent to a LiveKit room. The critical path is:
1. Mobile app calls API to start a voice session
2. API fetches the active profile from `starter_agent_settings` where `is_active = TRUE`
3. API passes profile config as metadata in the LiveKit dispatch call
4. Voice agent reads metadata once at session start and never re-reads it

If the "active" switch happens between step 2 and step 4 (or after step 4 for an ongoing session), the agent uses stale config. More commonly: the API caches the profile settings (via `schemaCapabilitiesPromise` singleton in `starter-agent-settings.ts:51`), so even new sessions may get stale config until the API process restarts.

**Consequences:** Config changes appear to have no effect. Operators think the feature is broken. They may try switching profiles repeatedly, creating confusion about which profile is actually active.

**Prevention:**
1. The "activate profile" endpoint must clear any in-memory caches in the API process. Currently `schemaCapabilitiesPromise` caches schema capabilities (not profile data), but verify no other caching layer exists
2. Add a `configVersion` or `profileId` field to the profile response and include it in session metadata so call logs can show which profile version a session used
3. Document clearly in the dashboard UI: "Changes apply to new sessions only. Active sessions will continue using their original configuration."
4. For the session-start API route, always fetch the active profile fresh from the database (no caching of profile content)

**Detection:** Compare the `profileId` in call log metadata against the currently active profile. If they diverge after the activation timestamp, propagation failed.

**Phase:** Phase 2 (profile CRUD and activation). The activation endpoint and session-start code must be reviewed together.

---

### Pitfall 4: Call Log Schema That Cannot Be Queried Efficiently

**What goes wrong:** Call logs are stored as unstructured JSONB blobs or in a schema that mirrors the LiveKit session model too closely, making common dashboard queries (filter by profile, filter by date range, sort by duration, count failures) require full table scans or complex JSON path queries.

**Why it happens:** The voice agent currently reports session end via `_notify_session_end()` in `entrypoint.py:1170-1177`, which sends a webhook to the API with metadata including `started_at`, `ended_at`, `room_name`, and the raw metadata dict. Teams often store this payload as-is in a single JSONB column, planning to "structure it later."

**Consequences:** Dashboard call log pages load slowly as log volume grows. Filtering by profile requires `WHERE metadata->>'profileId' = $1` which cannot use a standard btree index. Aggregation queries for the dashboard overview (calls per day, average duration, failure rate) become expensive.

**Prevention:**
1. Design the `call_logs` table with explicit columns for the fields you need to filter/sort: `id`, `room_name`, `profile_id`, `profile_name`, `started_at` (timestamptz), `ended_at` (timestamptz), `duration_seconds` (computed or stored), `status` (enum: completed/failed/abandoned), `metadata` (JSONB for the rest)
2. Add indexes on `(profile_id, started_at)` and `(started_at)` from day one
3. Store `profile_id` as a foreign key to the profiles table (but allow NULLs for sessions that used a since-deleted profile)
4. Compute `duration_seconds` as a generated column: `GENERATED ALWAYS AS (EXTRACT(EPOCH FROM ended_at - started_at)) STORED`

**Detection:** Dashboard call log page takes more than 500ms to load with fewer than 10,000 records.

**Phase:** Phase 3 (call logs). Schema must be designed before any call log ingestion code is written.

---

## Moderate Pitfalls

### Pitfall 5: Next.js App Router Server Components Calling the Express API

**What goes wrong:** Server Components in Next.js App Router make `fetch()` calls to the Express API at build time or from the Next.js server process. These server-side requests bypass CORS (no browser), but they need the admin JWT token, which lives in the browser (localStorage or cookies). The result: server components cannot authenticate, so developers end up making everything a Client Component, defeating the purpose of App Router.

**Prevention:**
1. Use App Router but accept that profile CRUD pages are Client Components (they need auth tokens from the browser). This is fine -- the dashboard is an interactive SPA-like tool, not a content site.
2. Use Server Components only for the layout shell, static UI, and any non-authenticated content
3. Create a shared `useApi()` hook that reads the JWT from client-side storage and passes it in headers, similar to the admin panel's existing `request()` wrapper in `lib/api.ts`
4. Do NOT try to pass JWT via cookies to enable Server Component auth -- it adds complexity for zero benefit in an internal ops tool

**Phase:** Phase 1 (project scaffolding). Architecture decision must be made before any page development.

---

### Pitfall 6: npm Workspace Hoisting Conflicts Between React (Admin) and Next.js (Dashboard)

**What goes wrong:** Adding `apps/voice-dashboard` to the npm workspaces causes dependency hoisting conflicts. Next.js and the existing Vite-based admin panel both depend on React, but potentially different versions. npm hoists one version to the root `node_modules/` and symlinks the other, causing "Invalid hook call" errors or hydration mismatches in the Next.js app.

**Prevention:**
1. Pin React version explicitly in the dashboard's `package.json` to match the admin panel's version. Check current version: `npm ls react --workspace=apps/admin`
2. Add the dashboard workspace to root `package.json` workspaces array: `"apps/voice-dashboard"`
3. If version conflicts arise, add `overrides` in root `package.json` to force a single React version
4. Test `npm install` from a clean state (delete `node_modules/` and `package-lock.json`) after adding the workspace
5. Note: the mobile app (`apps/mobile`) is NOT in the workspaces array (it uses `--prefix` instead). If mobile's React Native version conflicts, that is already handled by isolation. The dashboard does not have this luxury since it IS a workspace member.

**Detection:** `npm install` emits `ERESOLVE` warnings. At runtime: "Cannot read properties of null (reading 'useState')" or "Invalid hook call" errors.

**Phase:** Phase 1 (project scaffolding). Must be resolved before any dashboard code is written.

---

### Pitfall 7: VoiceAgentSettingsPage Data Migration Leaves Orphaned State

**What goes wrong:** The existing `VoiceAgentSettingsPage` in the admin panel writes to `starter_agent_settings` table using `device_id` as the primary key (which doubles as a profile identifier). The new dashboard introduces a proper `profiles` table with UUIDs. After migration, the admin panel's page still exists and still writes to the old table, creating a split-brain situation where some settings live in the old table and some in the new.

**Prevention:**
1. Phase the transition: first build the dashboard reading from the existing `starter_agent_settings` table (reuse the schema as-is for Phase 1-2)
2. Only introduce a new `profiles` table schema in a later phase, with a one-time migration script that converts `starter_agent_settings` rows to profile rows
3. Remove or disable the `VoiceAgentSettingsPage` from the admin panel BEFORE the dashboard goes live -- not after. Add a redirect notice: "Voice agent settings have moved to agent.coziyoo.com"
4. Never run both UIs simultaneously writing to the same table without one being read-only

**Detection:** Two different profiles exist for the same agent configuration -- one in the old table, one in the new. Voice sessions use the old table's data because the dispatch code was not updated to read from the new table.

**Phase:** Phase 2 (profile CRUD). The old page must be deprecated before the new dashboard activates.

---

### Pitfall 8: Profile Activation Transaction Not Truly Atomic

**What goes wrong:** The current activation code in `admin-livekit.ts:494-505` runs `BEGIN`, `UPDATE ... SET is_active = FALSE`, `UPDATE ... SET is_active = TRUE`, `COMMIT` using the shared connection pool. If two operators activate different profiles simultaneously, a race condition can leave zero or two profiles marked as active.

**Prevention:**
1. Add a `SELECT ... FOR UPDATE` lock on the rows before modifying them, or use a single UPDATE statement: `UPDATE starter_agent_settings SET is_active = (device_id = $1)` in one query
2. Add a partial unique index: `CREATE UNIQUE INDEX idx_one_active_profile ON starter_agent_settings (is_active) WHERE is_active = TRUE` -- this makes the database enforce the invariant
3. The new dashboard's activation endpoint should use the same pattern with the partial unique index as a safety net

**Detection:** `SELECT COUNT(*) FROM starter_agent_settings WHERE is_active = TRUE` returns 0 or more than 1.

**Phase:** Phase 2 (profile activation). Fix the existing endpoint before building the dashboard UI on top of it.

---

### Pitfall 9: Next.js Build Output Conflicts with Existing Nginx/systemd Deployment

**What goes wrong:** The existing deployment (`update_all.sh`) builds the admin panel as static files served by Nginx. Next.js in production requires a running Node.js process (for API routes, SSR, etc.). The deployment scripts do not account for a second Node.js service, so the dashboard either is not started after deployment or conflicts with the API port.

**Prevention:**
1. Create a new systemd service file for the dashboard (e.g., `coziyoo-voice-dashboard.service`) running `next start` on a dedicated port (e.g., 3001)
2. Add the dashboard to `update_all.sh`: build step (`npm run build --workspace=apps/voice-dashboard`) and service restart (`systemctl restart coziyoo-voice-dashboard`)
3. Add Nginx proxy rule: `agent.coziyoo.com` -> `127.0.0.1:3001`
4. Alternatively, export the Next.js app as static (`output: 'export'` in `next.config.js`) if no server-side features are needed. This simplifies deployment to match the admin panel pattern. Given that the dashboard is a client-heavy SPA with JWT auth, static export is viable and recommended.

**Detection:** After deployment, `agent.coziyoo.com` returns 502 Bad Gateway or serves stale content.

**Phase:** Phase 1 (project scaffolding). Deployment strategy must be decided before any code is written, because it determines whether to use App Router SSR features or static export.

---

## Minor Pitfalls

### Pitfall 10: JWT `aud` Claim Not Validated

**What goes wrong:** The CONCERNS.md already flags that JWT audience claims are not validated. The voice dashboard adds a third consumer of admin tokens. If an `app`-realm token (from a buyer/seller) somehow reaches the dashboard, it would be rejected by `requireAuth("admin")` because the realm check works. However, if the realm check were ever loosened, the lack of audience validation becomes a privilege escalation vector.

**Prevention:** When building the dashboard auth, explicitly check that the decoded JWT has `realm: "admin"` on the client side before storing it. Do not rely solely on the API's middleware -- fail fast in the UI.

**Phase:** Phase 1 (auth integration). Low effort, high value.

---

### Pitfall 11: LiveKit Webhook Events Not Reaching the API

**What goes wrong:** LiveKit can send webhook events (room started, participant joined, participant left, room ended) to a configured URL. Teams plan to use these for call log capture but forget to configure the webhook URL in LiveKit server settings, or the webhook receiver endpoint does not exist in the API.

**Prevention:**
1. If using LiveKit webhooks for call logs: create the receiver endpoint first, then configure LiveKit's `webhook_url` in its config
2. Alternatively (simpler): continue using the existing pattern where the voice agent calls `_notify_session_end()` at disconnect time, and extend it to include more metadata. This avoids LiveKit webhook configuration entirely.
3. The simpler approach has a gap: if the voice agent crashes mid-session, no end event is sent. Add a periodic cleanup job that marks sessions as "abandoned" if no end event arrives within N minutes of the start event.

**Phase:** Phase 3 (call logs). Architecture decision on webhook vs agent-reported logs.

---

### Pitfall 12: Forgetting to Add `apps/voice-dashboard` to CI/CD

**What goes wrong:** The GitHub Actions workflow (`.github/workflows/deploy-on-push.yml`) SSHes to VPS targets and runs `update_all.sh`. If the dashboard workspace is not added to the build/deploy scripts, pushes to main do not deploy dashboard changes.

**Prevention:**
1. Add the dashboard build step to `update_all.sh`
2. Add the dashboard systemd service restart (if using Node.js server mode)
3. Test the full deploy pipeline on a staging VPS before merging the dashboard

**Phase:** Phase 1 (project scaffolding). Include in the initial workspace setup PR.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Phase 1: Scaffolding | CORS rejection on first API call (Pitfall 1) | Add dashboard origins to CORS defaults in env.ts and .env.example |
| Phase 1: Scaffolding | npm workspace hoisting conflicts (Pitfall 6) | Pin React version, test clean install |
| Phase 1: Scaffolding | Deployment not configured (Pitfall 9, 12) | Decide static export vs Node.js server; update deploy scripts |
| Phase 2: Auth | JWT refresh token race (Pitfall 2) | Use separate login sessions per app |
| Phase 2: Profiles | Activation not atomic (Pitfall 8) | Add partial unique index on is_active |
| Phase 2: Profiles | Old admin page creates split-brain (Pitfall 7) | Deprecate old page before dashboard goes live |
| Phase 2: Profiles | Config not propagating (Pitfall 3) | Fetch active profile fresh per session; include profileId in metadata |
| Phase 3: Call Logs | Unqueryable schema (Pitfall 4) | Design explicit columns with indexes from day one |
| Phase 3: Call Logs | LiveKit webhooks not configured (Pitfall 11) | Use agent-reported events, add abandoned session cleanup |

## Sources

- `apps/api/src/middleware/auth.ts` -- JWT realm check implementation (lines 4-30)
- `apps/api/src/config/env.ts` -- CORS and env schema (lines 19-20)
- `apps/api/src/app.ts` -- CORS middleware implementation (lines 35-81)
- `apps/api/src/routes/admin-livekit.ts` -- Profile activation transaction (lines 487-511), agent settings CRUD (lines 420-588)
- `apps/api/src/routes/admin-auth.ts` -- Admin login/refresh flow
- `apps/api/src/services/starter-agent-settings.ts` -- Schema capabilities caching (line 51)
- `apps/voice-agent/src/voice_agent/entrypoint.py` -- Session metadata reading (lines 1089-1100), session end reporting (lines 1170-1177)
- `apps/voice-agent/src/voice_agent/config/settings.py` -- Agent settings from env
- `.planning/codebase/CONCERNS.md` -- JWT audience mismatch, missing test coverage
- `.planning/PROJECT.md` -- Project constraints and requirements
- Root `package.json` -- Workspace configuration
- `.env` -- Current CORS origins (already includes agent.coziyoo.com in production)
