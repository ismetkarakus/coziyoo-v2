# Phase 4: Call Logs - Research

**Researched:** 2026-03-22
**Domain:** Voice session persistence + dashboard log browsing (FastAPI BFF + Express API + Postgres)
**Confidence:** HIGH

## Summary

The voice agent already emits a session-end event to `POST /v1/livekit/session/end` from `apps/voice-agent/src/voice_agent/entrypoint.py` via `_notify_session_end(...)`. The API route currently validates payload, forwards to n8n (`sendSessionEndEvent`), and returns delivery status, but does not persist a database record.

Phase 4 should add a dedicated call-log persistence path in API and expose a read endpoint for dashboard consumption. The dashboard is already same-origin FastAPI+HTMX (`/dashboard/*`) and can reuse the existing BFF pattern used by profile management.

Key finding: profile context is available at session start (`settingsProfileId` in metadata) but not explicitly stored on session end payload. We should propagate profile id (or resolved active profile id) into the session-end event so logs can reference `agent_profiles`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOGS-01 | Persist session end to DB with profile ID, start, duration, outcome | Add `agent_call_logs` table + write path in `/v1/livekit/session/end` after validation |
| LOGS-02 | Dashboard table of past sessions (date, duration, profile, outcome) | Add admin API read endpoint and HTMX table partial in voice-agent dashboard |
| LOGS-03 | Filter by profile | Support `profileId` query param in API + filter UI control |
| LOGS-04 | Filter by date range | Support `from`/`to` query params in API + URL-driven filter state |
</phase_requirements>

## Recommended Data Model

`agent_call_logs` (new table):
- `id uuid primary key default gen_random_uuid()`
- `room_name text not null`
- `profile_id uuid null references agent_profiles(id) on delete set null`
- `started_at timestamptz not null`
- `ended_at timestamptz not null`
- `duration_seconds integer not null check (duration_seconds >= 0)`
- `outcome text not null default 'completed'`
- `summary text null`
- `device_id text null`
- `created_at timestamptz not null default now()`

Indexes:
- `agent_call_logs_started_at_idx (started_at desc)`
- `agent_call_logs_profile_started_idx (profile_id, started_at desc)`
- optional: `agent_call_logs_outcome_idx (outcome)`

## API Design

Write path:
- Extend `/v1/livekit/session/end` handling:
  1. Keep shared-secret auth and n8n forwarding unchanged.
  2. Parse/resolve `profileId` from payload metadata (`settingsProfileId`) or explicit field.
  3. Compute `duration_seconds = max(0, ended_at - started_at)` when both exist.
  4. Insert into `agent_call_logs` regardless of n8n result (best-effort n8n should not block internal observability).

Read path:
- New admin route: `GET /v1/admin/agent-call-logs`
- Query params:
  - `profileId` (uuid, optional)
  - `from` (ISO datetime/date, optional)
  - `to` (ISO datetime/date, optional)
  - `limit` (default 50, max 200)
  - `offset` (default 0)
- Response shape:
  - list rows joined with profile name (`left join agent_profiles`)
  - sorted by `started_at desc`

## Dashboard Design (FastAPI+HTMX)

- New page route: `GET /dashboard/call-logs`
- New partial endpoint: `GET /dashboard/call-logs/table`
- Filters submitted via GET to keep URL authoritative:
  - `profileId`
  - `from`
  - `to`
- Table columns:
  - Started At
  - Duration
  - Profile
  - Outcome
  - Room

Reuse existing server-side proxy helper (`dashboard_api.py`) so browser does not call `api.coziyoo.com` directly.

## Risks and Mitigations

- Missing/invalid profile IDs from old sessions:
  - Mitigation: `profile_id` nullable + `on delete set null` + display `Unknown` profile label.
- Session end failures to n8n:
  - Mitigation: decouple persistence from n8n delivery result.
- Large tables over time:
  - Mitigation: add started_at/profile indexes and capped default pagination.

## Recommended Plan Split

1. `04-01`: DB schema + API persistence + admin list endpoint + tests.
2. `04-02`: Dashboard call logs page and table rendering.
3. `04-03`: Profile/date filters with URL persistence + final UX polish and verification.

