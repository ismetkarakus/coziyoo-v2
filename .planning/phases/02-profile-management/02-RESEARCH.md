# Phase 2: Profile Management - Research

**Researched:** 2026-03-22
**Domain:** Full-stack profile CRUD (PostgreSQL + Express API + Next.js dashboard UI)
**Confidence:** HIGH

## Summary

Phase 2 builds the core reason the voice dashboard exists: creating, configuring, and activating voice agent profiles through a tabbed editor UI. This phase has two layers -- (1) backend: a new `agent_profiles` table in Supabase + CRUD API routes under `/v1/admin/agent-profiles`, and (2) frontend: replacing the placeholder dashboard page with a left-sidebar profile list and 4-tab editor (Model | Voice | Transcriber | Tools) in the Next.js app.

The existing `VoiceAgentSettingsPage.tsx` in `apps/admin` (~600 lines) is the reference implementation. It already implements: multi-server STT/TTS/N8N management with inline forms, cURL import parsing, connection testing (live TTS audio playback, mic recording + STT transcription, N8N ping), key-value param editors, system prompt editor, and greeting config. The new dashboard ports this functionality into a cleaner architecture using React Hook Form + Zod + shadcn/ui + TanStack Query, organized by the 4-tab pattern. The backend work introduces a proper `agent_profiles` table with separate JSONB columns per config domain (replacing the monolithic `tts_config_json` blob in `starter_agent_settings`), plus new CRUD endpoints.

**Primary recommendation:** Build backend API routes first (testable with curl), then build the frontend profile list + tabbed editor. Use the OpenAI-compatible base schema (`base_url`, `api_key`, `model`, `endpoint_path`, `custom_headers`, `custom_body_params`) as the unified config shape for all provider tabs.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROF-01 | User can create a named agent profile | New `POST /v1/admin/agent-profiles` endpoint + create dialog in sidebar |
| PROF-02 | User can view all profiles in a left sidebar list | New `GET /v1/admin/agent-profiles` endpoint + sidebar component with TanStack Query |
| PROF-03 | User can delete a profile (with confirmation, cannot delete active) | New `DELETE /v1/admin/agent-profiles/:id` endpoint + confirmation dialog |
| PROF-04 | User can clone an existing profile | New `POST /v1/admin/agent-profiles/:id/duplicate` endpoint |
| PROF-05 | User can mark one profile as active (exclusive) | New `POST /v1/admin/agent-profiles/:id/activate` with partial unique index |
| PROF-06 | Active profile visually indicated in sidebar | Badge/highlight in sidebar list item, driven by `is_active` field |
| MODEL-01 | LLM base connection (base URL, API key, model) | `llm_config` JSONB column, OpenAI-compatible schema, Model tab form |
| MODEL-02 | Custom request headers for LLM | `custom_headers` field within `llm_config` JSONB |
| MODEL-03 | Custom body params for LLM | `custom_body_params` field within `llm_config` JSONB |
| MODEL-04 | Custom endpoint path for LLM | `endpoint_path` field within `llm_config` JSONB, default `/v1/chat/completions` |
| MODEL-05 | System prompt editor | `system_prompt` TEXT column on `agent_profiles`, textarea in Model tab |
| MODEL-06 | First message config (speaks first or waits) | `greeting_enabled` BOOLEAN column |
| MODEL-07 | Greeting instruction text | `greeting_instruction` TEXT column |
| VOICE-01 | TTS base connection (base URL, API key) | `tts_config` JSONB column, OpenAI-compatible schema, Voice tab form |
| VOICE-02 | Custom TTS endpoint path | `endpoint_path` field within `tts_config`, default `/v1/audio/speech` |
| VOICE-03 | Voice ID for TTS | `voice_id` field within `tts_config` |
| VOICE-04 | Custom body params for TTS | `custom_body_params` within `tts_config` (speed, format, model, etc.) |
| VOICE-05 | Custom request headers for TTS | `custom_headers` within `tts_config` |
| VOICE-06 | Test TTS with audio playback | Existing `POST /admin/livekit/test/tts` endpoint, new browser audio playback UI |
| STT-01 | STT base connection (base URL, API key) | `stt_config` JSONB column, OpenAI-compatible schema, Transcriber tab form |
| STT-02 | Custom STT endpoint path | `endpoint_path` within `stt_config`, default `/v1/audio/transcriptions` |
| STT-03 | STT model and language | `model` and `language` fields within `stt_config` |
| STT-04 | Custom request headers for STT | `custom_headers` within `stt_config` |
| STT-05 | Custom body/query params for STT | `custom_body_params` and `custom_query_params` within `stt_config` |
| STT-06 | Test STT with mic recording | Existing `POST /admin/livekit/test/stt/transcribe` endpoint, new mic recording UI |
| TOOLS-01 | N8N webhook base URL | `n8n_config` JSONB column, `base_url` field |
| TOOLS-02 | N8N webhook path for order processing | `webhook_path` field within `n8n_config` |
| TOOLS-03 | N8N MCP webhook path | `mcp_webhook_path` field within `n8n_config` |
| TOOLS-04 | Test N8N connectivity | Existing `POST /admin/livekit/test/n8n` endpoint, new test UI |
| TOOLS-05 | cURL import (auto-fill fields) | Port `parseCurlCommand()` from VoiceAgentSettingsPage.tsx |
</phase_requirements>

## Standard Stack

### Core (already installed in Phase 1)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| Next.js | 16.2.1 | App framework | Installed |
| React | 19.2.4 | UI library | Installed |
| shadcn/ui | latest | Component library (source-copied) | Partially installed (button, card, input, label, sonner) |
| Sonner | 2.x | Toast notifications | Installed |
| Lucide React | latest | Icons | Installed |

### New Dependencies for Phase 2

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | 5.x | Server state, caching, mutations | Profile CRUD and list fetching; eliminates manual loading/error state management |
| react-hook-form | 7.x | Form state management | Profile config form has 20+ fields across 4 tabs; uncontrolled components prevent re-renders |
| @hookform/resolvers | latest | RHF + Zod bridge | `zodResolver(profileSchema)` for form validation |
| zod | 4.x | Schema validation | Already in API (4.3.6); share profile schema between dashboard and API |

### shadcn/ui Components to Add

These must be installed via `npx shadcn@latest add` before building UI:

| Component | Purpose |
|-----------|---------|
| tabs | 4-tab profile editor (Model/Voice/Transcriber/Tools) |
| textarea | System prompt editor, greeting instruction |
| dialog | Create profile, delete confirmation, cURL import modal |
| badge | Active profile indicator, connection test status |
| separator | Section dividers in forms |
| sidebar | Left sidebar profile list (shadcn sidebar component) |
| select | Language picker, provider selection |
| switch | Greeting enabled toggle, profile enabled toggle |
| tooltip | Info hints on form fields |
| scroll-area | Sidebar profile list scrolling |
| skeleton | Loading states for profile list and form |
| alert-dialog | Delete confirmation ("cannot delete active profile") |
| dropdown-menu | Profile actions (clone, delete) |
| sheet | Mobile-responsive sidebar |

**Installation:**
```bash
# New runtime dependencies
npm install @tanstack/react-query react-hook-form @hookform/resolvers zod --workspace=apps/voice-dashboard

# Dev dependencies
npm install -D @tanstack/react-query-devtools --workspace=apps/voice-dashboard

# shadcn/ui components (run from apps/voice-dashboard directory)
npx shadcn@latest add tabs textarea dialog badge separator sidebar select switch tooltip scroll-area skeleton alert-dialog dropdown-menu sheet
```

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)

```
apps/voice-dashboard/src/
  app/
    (dashboard)/
      layout.tsx              -- UPDATE: Add sidebar with profile list
      dashboard/page.tsx      -- UPDATE: Redirect to /profiles or show overview
      profiles/
        page.tsx              -- Profile list view (redirects to first profile or empty state)
        [id]/
          page.tsx            -- Profile editor with 4-tab layout
      ...
  components/
    auth-guard.tsx            -- EXISTS from Phase 1
    profile-sidebar.tsx       -- NEW: Left sidebar with profile list, create button, active indicator
    profile-editor.tsx        -- NEW: Tabbed form wrapper
    tabs/
      model-tab.tsx           -- NEW: LLM config + system prompt + greeting
      voice-tab.tsx           -- NEW: TTS config + audio test
      transcriber-tab.tsx     -- NEW: STT config + mic test
      tools-tab.tsx           -- NEW: N8N config + connectivity test
    forms/
      key-value-editor.tsx    -- NEW: Reusable key-value param editor (headers, body params, query params)
      curl-import-dialog.tsx  -- NEW: Port of CurlImportModal
      connection-test.tsx     -- NEW: Reusable test button with status indicator
    ui/                       -- shadcn/ui components
  lib/
    api.ts                    -- EXISTS from Phase 1
    auth.ts                   -- EXISTS from Phase 1
    types.ts                  -- UPDATE: Add AgentProfile, ProfileConfig types
    hooks/
      use-profiles.ts         -- NEW: TanStack Query hooks for profile CRUD
      use-connection-test.ts  -- NEW: Hook for connection testing
    schemas/
      profile.ts              -- NEW: Zod schemas for profile validation
    utils/
      curl-parser.ts          -- NEW: Port of parseCurlCommand() from admin
  providers/
    query-provider.tsx        -- NEW: TanStack Query provider wrapper
```

### Pattern 1: TanStack Query Provider Setup

The root layout needs a QueryClientProvider. Since the root layout is a Server Component, create a client wrapper.

```typescript
// src/providers/query-provider.tsx
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,        // Profiles don't change frequently
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

### Pattern 2: Profile CRUD Hooks with TanStack Query

```typescript
// src/lib/hooks/use-profiles.ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { request, parseJson } from "@/lib/api";
import type { AgentProfile } from "@/lib/types";

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const res = await request("/v1/admin/agent-profiles");
      const json = await parseJson<{ data: AgentProfile[] }>(res);
      return json.data;
    },
  });
}

export function useProfile(id: string) {
  return useQuery({
    queryKey: ["profiles", id],
    queryFn: async () => {
      const res = await request(`/v1/admin/agent-profiles/${id}`);
      const json = await parseJson<{ data: AgentProfile }>(res);
      return json.data;
    },
    enabled: !!id,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<AgentProfile> }) => {
      const res = await request(`/v1/admin/agent-profiles/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return parseJson<{ data: AgentProfile }>(res);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["profiles", id] });
    },
  });
}

export function useActivateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await request(`/v1/admin/agent-profiles/${id}/activate`, { method: "POST" });
      return parseJson<{ data: { active: string } }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
}
```

### Pattern 3: React Hook Form with Zod for Tabbed Profile Editor

The profile editor form wraps all 4 tabs in a single React Hook Form instance. Each tab reads/writes to its section of the form.

```typescript
// src/lib/schemas/profile.ts
import { z } from "zod";

const openAiCompatibleSchema = z.object({
  base_url: z.string().url().or(z.literal("")),
  api_key: z.string().optional(),
  model: z.string().optional(),
  endpoint_path: z.string().optional(),
  custom_headers: z.record(z.string(), z.string()).optional(),
  custom_body_params: z.record(z.string(), z.string()).optional(),
});

export const profileFormSchema = z.object({
  name: z.string().min(1, "Profile name is required").max(128),

  // Model tab
  llm_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/chat/completions"),
  }),
  system_prompt: z.string().max(4000).optional(),
  greeting_enabled: z.boolean().default(true),
  greeting_instruction: z.string().max(2000).optional(),
  voice_language: z.string().default("tr"),

  // Voice tab
  tts_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/audio/speech"),
    voice_id: z.string().optional(),
    text_field_name: z.string().default("input"),
  }),

  // Transcriber tab
  stt_config: openAiCompatibleSchema.extend({
    endpoint_path: z.string().default("/v1/audio/transcriptions"),
    language: z.string().optional(),
    custom_query_params: z.record(z.string(), z.string()).optional(),
  }),

  // Tools tab
  n8n_config: z.object({
    base_url: z.string().url().or(z.literal("")),
    webhook_path: z.string().optional(),
    mcp_webhook_path: z.string().optional(),
  }),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
```

### Pattern 4: Connection Testing Hook

```typescript
// src/lib/hooks/use-connection-test.ts
"use client";
import { useState, useCallback } from "react";
import { request, parseJson } from "@/lib/api";

type TestResult = { ok: boolean; detail?: string } | null;

export function useConnectionTest() {
  const [result, setResult] = useState<TestResult>(null);
  const [testing, setTesting] = useState(false);

  const testStt = useCallback(async (baseUrl: string, transcribePath?: string) => {
    setTesting(true);
    setResult(null);
    try {
      const res = await request("/v1/admin/livekit/test/stt", {
        method: "POST",
        body: JSON.stringify({ baseUrl, transcribePath }),
      });
      const json = await parseJson<{ data: { ok: boolean; reason?: string } }>(res);
      setResult({ ok: json.data.ok, detail: json.data.reason });
    } catch {
      setResult({ ok: false, detail: "Request failed" });
    } finally {
      setTesting(false);
    }
  }, []);

  // Similar for testTts, testN8n...
  return { result, testing, testStt };
}
```

### Anti-Patterns to Avoid

- **One giant form component:** Do not put all 4 tabs in one file. Split each tab into its own component that receives RHF `control` and `register` props.
- **Direct DB access from Next.js:** All data flows through the Express API. Never import `pg` in the dashboard.
- **Server Actions for mutations:** The Express API is the single backend. Use TanStack Query mutations calling REST endpoints.
- **Storing form state in URL:** Use URL only for the active profile ID and active tab. Form field values live in React Hook Form state.
- **Manual loading/error states:** Use TanStack Query's `isLoading`, `isError`, `data` pattern. Do not manage these with useState.

## Database Schema

### Table: `agent_profiles` (new, replaces `starter_agent_settings`)

Apply directly to Supabase -- do NOT create migration files.

```sql
CREATE TABLE agent_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT FALSE,

  -- Model tab (top-level fields for queryability)
  system_prompt TEXT,
  greeting_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  greeting_instruction TEXT,
  voice_language TEXT NOT NULL DEFAULT 'tr',

  -- Provider config (JSONB per domain)
  llm_config    JSONB NOT NULL DEFAULT '{}',
  stt_config    JSONB NOT NULL DEFAULT '{}',
  tts_config    JSONB NOT NULL DEFAULT '{}',
  n8n_config    JSONB NOT NULL DEFAULT '{}',

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce exactly one active profile
CREATE UNIQUE INDEX agent_profiles_one_active_idx
  ON agent_profiles (is_active) WHERE is_active = TRUE;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_profiles_updated_at
  BEFORE UPDATE ON agent_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### JSONB Column Shape (OpenAI-compatible base)

Each provider config column follows the same base schema:

```json
{
  "base_url": "https://api.openai.com",
  "api_key": "sk-...",
  "model": "gpt-4o",
  "endpoint_path": "/v1/chat/completions",
  "custom_headers": { "X-Custom": "value" },
  "custom_body_params": { "temperature": "0.7" }
}
```

Additional fields per domain:
- `tts_config`: `voice_id`, `text_field_name` (default "input")
- `stt_config`: `language`, `custom_query_params`
- `n8n_config`: `webhook_path`, `mcp_webhook_path` (no api_key/model)

### Data Migration

The existing `starter_agent_settings` data must be migrated to `agent_profiles`. This is a one-time operation:

1. Read all rows from `starter_agent_settings`
2. For each row, map `tts_config_json` blob fields to the new JSONB columns
3. Insert into `agent_profiles`
4. Update `getStarterAgentSettingsWithDefault()` in `livekit.ts` to read from `agent_profiles WHERE is_active = TRUE`

This must happen atomically with the API route switch to avoid the split-brain problem (Pitfall 7).

## API Routes to Build

### New Routes (all under `requireAuth("admin")`)

| Method | Path | Purpose | Request Body | Response |
|--------|------|---------|-------------|----------|
| GET | `/v1/admin/agent-profiles` | List all profiles | - | `{ data: AgentProfile[] }` |
| POST | `/v1/admin/agent-profiles` | Create profile | `{ name, llm_config?, ... }` | `{ data: AgentProfile }` |
| GET | `/v1/admin/agent-profiles/:id` | Get profile detail | - | `{ data: AgentProfile }` |
| PUT | `/v1/admin/agent-profiles/:id` | Update profile | `{ name?, llm_config?, ... }` | `{ data: AgentProfile }` |
| DELETE | `/v1/admin/agent-profiles/:id` | Delete profile (not active) | - | `{ data: { deleted: id } }` |
| POST | `/v1/admin/agent-profiles/:id/activate` | Set as active | - | `{ data: { active: id } }` |
| POST | `/v1/admin/agent-profiles/:id/duplicate` | Clone profile | - | `{ data: AgentProfile }` |

### Existing Routes to Reuse (no changes needed)

| Method | Path | Purpose | Used By |
|--------|------|---------|---------|
| POST | `/v1/admin/livekit/test/stt` | Test STT connectivity | Transcriber tab |
| POST | `/v1/admin/livekit/test/stt/transcribe` | Live STT transcription | Transcriber tab mic test |
| POST | `/v1/admin/livekit/test/tts` | Test TTS with audio | Voice tab audio test |
| POST | `/v1/admin/livekit/test/n8n` | Test N8N connectivity | Tools tab |
| POST | `/v1/admin/livekit/test/livekit` | Test LiveKit connectivity | Settings/status |

### Existing Route to Modify

| Route | Change Required |
|-------|----------------|
| `getStarterAgentSettingsWithDefault()` in `livekit.ts` | Add fallback: if no `starter_agent_settings` found, try `SELECT * FROM agent_profiles WHERE is_active = TRUE` |
| VoiceAgentSettingsPage in admin panel | Add deprecation notice / redirect to `agent.coziyoo.com` |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Form state with 20+ fields across tabs | Manual useState per field | React Hook Form 7 with `useForm()` | Tab switching loses state; RHF preserves all field values across tab navigation |
| Server state caching | Custom fetch + useState + useEffect | TanStack Query `useQuery`/`useMutation` | Handles caching, refetching, loading states, optimistic updates, error boundaries |
| Schema validation | Manual if/else validation | Zod schemas with `zodResolver` | Single source of truth for both client validation and API request validation |
| Toast feedback | Custom notification system | Sonner (already installed) | `toast.success("Saved")` one-liner |
| Key-value parameter editors | From-scratch key-value table | Reusable `KeyValueEditor` component | Used in 6+ places (headers, body params, query params for STT, TTS, LLM) |
| cURL parsing | New parser | Port existing `parseCurlCommand()` from VoiceAgentSettingsPage | Already handles all edge cases (line continuations, quoted strings, form fields, JSON body) |
| Audio recording for STT test | WebRTC from scratch | `navigator.mediaDevices.getUserMedia` + `MediaRecorder` API | Existing admin page already uses this pattern in SttRecordPanel |
| Audio playback for TTS test | Custom audio player | `new Audio(URL.createObjectURL(blob))` | Existing test endpoint returns audio buffer directly |

## Common Pitfalls

### Pitfall 1: Tab State Lost on Navigation

**What goes wrong:** User fills out Model tab, switches to Voice tab, fills that out, switches back to Model -- all Model fields are empty because each tab component unmounts and remounts.

**Why it happens:** Without a shared form state, each tab manages its own useState. Unmounting destroys state.

**How to avoid:** Use a single React Hook Form instance at the profile editor level. Pass `control` and `register` to each tab component. RHF stores all values regardless of which tab is visible. Tabs should use CSS visibility or conditional rendering that doesn't unmount the form.

**Warning signs:** Users report "lost data" when switching tabs.

### Pitfall 2: Active Profile Deletion

**What goes wrong:** User deletes the active profile. Now no profile is active. Voice sessions fail because `getStarterAgentSettingsWithDefault()` finds no active profile.

**How to avoid:** The DELETE endpoint must check `is_active = TRUE` and reject deletion with a 409 error: "Cannot delete the active profile. Activate a different profile first." The frontend should also disable the delete button for the active profile.

### Pitfall 3: Profile Activation Race Condition

**What goes wrong:** Two admins activate different profiles simultaneously. The existing transaction pattern (`BEGIN; UPDATE SET FALSE; UPDATE SET TRUE; COMMIT`) can leave zero or two active profiles.

**How to avoid:** Add the partial unique index `agent_profiles_one_active_idx` (included in schema above). This makes the database enforce the invariant even if the transaction logic has a gap. Additionally, use `SELECT ... FOR UPDATE` before the UPDATE statements.

### Pitfall 4: Stale Profile Config in Voice Sessions

**What goes wrong:** Admin activates a new profile but ongoing voice sessions still use old config.

**How to avoid:** Accept this as expected behavior. Document in the UI: "Changes apply to new sessions only." The `getStarterAgentSettingsWithDefault()` function must always query the database fresh (no in-memory caching of profile config).

### Pitfall 5: JSONB Partial Updates Overwrite Data

**What goes wrong:** User updates only `llm_config` fields via the Model tab. The PUT request sends the full profile object but with empty/default values for `stt_config`, `tts_config`, `n8n_config`. The API overwrites all JSONB columns, losing STT/TTS/N8N config.

**How to avoid:** Two approaches:
1. (Recommended) Always send the full profile object from the form. React Hook Form `getValues()` returns all fields, not just changed ones.
2. (Backend safety) The PUT endpoint should merge JSONB columns with existing values if a field is not present in the request body.

### Pitfall 6: Missing shadcn Components

**What goes wrong:** Build fails because `tabs`, `dialog`, `textarea` etc. are not installed yet (Phase 1 only installed button, card, input, label, sonner).

**How to avoid:** Install all needed shadcn components before writing any UI code. See "shadcn/ui Components to Add" section above.

### Pitfall 7: Split-Brain with Old Admin Page

**What goes wrong:** Both VoiceAgentSettingsPage (admin panel) and new dashboard write to different tables simultaneously.

**How to avoid:** Add a deprecation banner to VoiceAgentSettingsPage immediately. After the `agent_profiles` table and CRUD routes are functional, make the admin page read-only or redirect to `agent.coziyoo.com`.

## Code Examples

### Existing Patterns to Port from VoiceAgentSettingsPage

#### cURL Parser (port verbatim)
Source: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx:35-153`
- `tokenizeCurl()` -- handles quoted strings, backslash-newline continuation
- `parseCurlCommand()` -- extracts URL, headers, body params, model, auth, text field name
- Returns `Partial<ServerDraft>` shape that maps to the OpenAI-compatible config schema

#### Key-Value Parameter Editor
Source: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx:207-227` (`QueryParamsEditor`)
- Add/remove rows, key/value inputs per row
- Reused for: custom headers, body params, query params across all tabs
- Port to shadcn/ui: use `Button` for add/remove, `Input` for key/value fields

#### Server Inline Form
Source: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx:231-289` (`ServerInlineForm`)
- Type-aware form that shows/hides fields based on server type (STT/TTS/N8N)
- In new dashboard: this maps to the tab-specific form sections

#### STT Recording Panel
Source: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx:338-393` (`SttRecordPanel`)
- Uses `MediaRecorder` API for browser mic recording
- Sends base64 audio to `POST /admin/livekit/test/stt/transcribe`
- Shows transcript result, raw response, debug info

### TanStack Query Provider Integration

Add to `apps/voice-dashboard/src/app/(dashboard)/layout.tsx`:

```typescript
"use client";
import { AuthGuard } from "@/components/auth-guard";
import { QueryProvider } from "@/providers/query-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <QueryProvider>
        <div className="flex min-h-screen">
          {/* Sidebar will be added here */}
          <main className="flex-1">{children}</main>
        </div>
      </QueryProvider>
    </AuthGuard>
  );
}
```

### Profile Form with React Hook Form

```typescript
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { profileFormSchema, type ProfileFormValues } from "@/lib/schemas/profile";

export function ProfileEditor({ profile }: { profile: AgentProfile }) {
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: mapProfileToFormValues(profile),
  });

  const onSubmit = (values: ProfileFormValues) => {
    updateProfile.mutate({ id: profile.id, data: mapFormValuesToProfile(values) });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Tabs defaultValue="model">
        <TabsList>
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="transcriber">Transcriber</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>
        <TabsContent value="model">
          <ModelTab control={form.control} register={form.register} />
        </TabsContent>
        {/* ... other tabs */}
      </Tabs>
    </form>
  );
}
```

## State of the Art

| Old Approach (VoiceAgentSettingsPage) | New Approach (Phase 2) | Impact |
|---------------------------------------|------------------------|--------|
| `device_id` as profile key | UUID primary key | Clean identity, no collision with device IDs |
| Single `tts_config_json` JSONB blob for all config | Separate `llm_config`, `stt_config`, `tts_config`, `n8n_config` columns | Each tab maps to one column; partial updates cleaner |
| Multi-server arrays (`sttServers[]`, `ttsServers[]`) | Single config per provider per profile | Simpler model -- use profile cloning for server variants |
| Inline styles, useState per field | shadcn/ui + React Hook Form | Consistent design, better form state management |
| Manual fetch + error handling | TanStack Query mutations | Automatic loading/error states, cache invalidation |
| No validation | Zod schemas | Client-side validation before API call |

**Key simplification:** The old `VoiceAgentSettingsPage` supports multiple servers per type (arrays of STT servers, TTS servers, N8N servers) within one profile. The new design uses **one config per provider per profile**, with profile cloning (PROF-04) as the mechanism for testing different server configurations. This eliminates the "default server selection" complexity and maps cleanly to the OpenAI-compatible base schema.

## Open Questions

1. **Multi-server vs single-server per profile:**
   - What we know: The old admin page supports arrays of STT/TTS/N8N servers per profile. The requirements (MODEL-01, VOICE-01, STT-01) describe single-config-per-provider.
   - What's unclear: Does the team actively use multiple servers within one profile, or is this legacy complexity?
   - Recommendation: Start with single config per provider (matches requirements). The clone feature (PROF-04) serves the "try a different server" use case. Can add multi-server later if needed.

2. **API key storage security:**
   - What we know: API keys for LLM/TTS/STT will be stored in JSONB columns in plain text.
   - What's unclear: Whether these need encryption at rest beyond Supabase's default.
   - Recommendation: For an internal tool, plain text in JSONB is acceptable. The API already stores passwords (argon2-hashed) but API keys are needed in cleartext for requests. Mask display in the UI (show last 4 chars only, full value on explicit reveal).

3. **Active profile propagation to voice agent:**
   - What we know: The API's `getStarterAgentSettingsWithDefault()` is called at session start and passes config via metadata. Changing to read from `agent_profiles` requires updating this function.
   - What's unclear: Whether the `schemaCapabilitiesPromise` cache in `starter-agent-settings.ts:51` affects profile propagation.
   - Recommendation: Verify during implementation. The function reads schema capabilities, not profile data, but trace the full path to confirm.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (matches apps/api) |
| Config file | Not yet created for voice-dashboard -- Wave 0 |
| Quick run command | `npm run test --workspace=apps/voice-dashboard -- --run` |
| Full suite command | `npm run test --workspace=apps/voice-dashboard` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROF-01 | Create profile via API | integration | `npm run test --workspace=apps/api -- --run src/routes/__tests__/agent-profiles.test.ts` | Wave 0 |
| PROF-03 | Cannot delete active profile | unit | Same as above | Wave 0 |
| PROF-05 | Activation is exclusive (one active) | unit | Same as above | Wave 0 |
| MODEL-01 | LLM config saved and returned | integration | Same as above | Wave 0 |
| VOICE-06 | TTS test returns audio | manual-only | Requires live TTS server | N/A |
| STT-06 | STT test transcribes audio | manual-only | Requires live STT server and browser mic | N/A |
| TOOLS-04 | N8N test shows success/fail | manual-only | Requires live N8N instance | N/A |

### Sampling Rate
- **Per task commit:** `npm run test --workspace=apps/api -- --run`
- **Per wave merge:** Full suite across api + voice-dashboard
- **Phase gate:** All API route tests green + manual verification of UI

### Wave 0 Gaps
- [ ] `apps/api/src/routes/__tests__/agent-profiles.test.ts` -- CRUD route tests for profiles
- [ ] `apps/voice-dashboard/vitest.config.ts` -- test framework config (if needed for component tests)
- [ ] Vitest + testing-library setup for voice-dashboard workspace

## Sources

### Primary (HIGH confidence)
- Existing codebase: `apps/admin/src/pages/VoiceAgentSettingsPage.tsx` -- reference implementation for all UI patterns, cURL parser, connection testing, form fields
- Existing codebase: `apps/admin/src/types/voice.ts` -- current data types (SttServer, TtsServer, N8nServer, AgentSettingsFull)
- Existing codebase: `apps/api/src/routes/admin-livekit.ts` -- existing CRUD endpoints, activation transaction, test endpoints
- Existing codebase: `apps/api/src/routes/livekit.ts` -- `getStarterAgentSettingsWithDefault()`, session start flow, provider resolution
- Existing codebase: `apps/voice-dashboard/` -- Phase 1 scaffold (layout, auth, API client, shadcn/ui base)
- `.planning/research/ARCHITECTURE.md` -- schema design, API route plan, data flow diagrams
- `.planning/research/STACK.md` -- stack decisions (TanStack Query, RHF, Zod, shadcn/ui)
- `.planning/research/PITFALLS.md` -- activation race condition, split-brain, CORS, propagation issues

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES.md` -- feature priority, capabilities to preserve from old page
- `.planning/REQUIREMENTS.md` -- requirement definitions and traceability

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries confirmed in Phase 1 research, versions verified from package.json
- Architecture: HIGH -- derived from direct analysis of existing codebase files and Phase 1 output
- Database schema: HIGH -- follows ARCHITECTURE.md recommendations, uses established PostgreSQL patterns
- Pitfalls: HIGH -- every pitfall grounded in specific files and lines in existing codebase

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable stack, internal tool)
