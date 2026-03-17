# Phase 7: User Memory — Design Context

## Decided Approach: Option C (Supabase session_memory + async write + end-of-session summary)

Decided: 2026-03-16

### Why this approach

- n8n stays the logic owner — behavior changes are workflow edits, not code deploys
- session_memory table already exists in Supabase (created Phase 1)
- Feeds Phase 7 naturally: session summaries build the long_term_memory user profile
- Latency impact is minimal (only the read blocks; write is async after response)

### Per-turn flow (n8n webhook workflow)

```
Webhook receives { sessionId, userMessage, userId }
  → Supabase READ: SELECT messages FROM session_memory WHERE session_id = $sessionId   ← blocking (~20-50ms)
  → Build messages array: [system prompt] + [history turns] + [new user turn]
  → LLM node (OpenAI / Ollama)
  → Respond to Webhook: { replyText: "..." }    ← user hears reply, no more blocking
  → Supabase WRITE: append { role: user, content } + { role: assistant, content } to session_memory   ← async
```

### End-of-session flow (existing end-of-call n8n webhook)

```
End-of-call webhook fires with { sessionId, userId }
  → Supabase READ: full session_memory for sessionId
  → LLM: "Summarize this session. Extract: foods discussed, order placed (yes/no + items),
           dietary preferences mentioned, unresolved questions, user tone/style notes"
  → Supabase WRITE: summary to long_term_memory (user profile row, upsert by userId)
  → Supabase DELETE or archive session_memory rows for sessionId
```

### Supabase schema (session_memory — already exists, verify shape)

Expected columns:
- `id` — uuid
- `session_id` — text (= LiveKit roomName)
- `user_id` — uuid (FK to users)
- `messages` — jsonb array of `{ role: "user"|"assistant", content: string, ts: timestamp }`
- `created_at`, `updated_at`

If `messages` is not a jsonb array, n8n can append by reading the array, pushing new items, and writing back.

### Supabase schema (long_term_memory — already exists, verify shape)

Expected columns:
- `user_id` — uuid (FK, unique)
- `preferences` — jsonb (dietary restrictions, favorite foods, etc.)
- `past_orders_summary` — text or jsonb
- `conversation_style` — text
- `last_updated` — timestamp

### What n8n injects into LLM context at session start

```json
{
  "systemPrompt": "You are Coziyoo voice assistant...\n\nUser profile:\n{long_term_memory summary}\n\nConversation so far:\n{session_memory history}"
}
```

### Latency budget

| Step | Latency | Blocking? |
|------|---------|-----------|
| STT | ~300-800ms | yes |
| session_memory READ | ~20-50ms | yes |
| LLM | ~500-2000ms | yes |
| Respond to Webhook | — | — |
| session_memory WRITE | ~20-50ms | no (after response) |

Read adds ~20-50ms to a turn that already takes 1-3 seconds. Acceptable.

### Implementation plans (to be created when Phase 7 starts)

- 07-01: Verify/update session_memory and long_term_memory schema in Supabase; confirm columns match expected shape
- 07-02: Implement n8n per-turn memory read (session_memory) + inject into LLM context; async write after response
- 07-03: Implement end-of-session summary: read session → LLM summarize → write to long_term_memory → archive session
- 07-04: Inject long_term_memory user profile into session start system prompt via n8n
