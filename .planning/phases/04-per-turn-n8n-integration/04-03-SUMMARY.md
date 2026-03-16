---
phase: 4
plan: "04-03"
slug: wire-voice-agent-n8n-webhook
subsystem: voice-agent
tags: [n8n, error-handling, logging, webhook, voice-agent]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [reliable-n8n-error-surfacing]
  affects: [voice-agent/entrypoint.py]
tech_stack:
  added: []
  patterns: [explicit-error-logging, no-silent-fallback]
key_files:
  created: []
  modified:
    - apps/voice-agent/src/voice_agent/entrypoint.py
decisions:
  - "Re-raise APIStatusError immediately without fallback — n8n HTTP errors indicate webhook reachability, not network failure; execution API fallback cannot help"
  - "Log raw response body (first 500 chars) before raising empty-answer error to aid misconfiguration diagnosis"
metrics:
  duration: "~5 min"
  completed: "2026-03-16"
  tasks_completed: 3
  tasks_total: 3
---

# Phase 4 Plan 03: Wire Voice Agent to N8N Webhook Summary

**One-liner:** n8n HTTP errors now re-raise immediately with no execution API fallback; connection errors log a named-path warning before fallback; empty-answer 200 responses log full raw body.

## What Was Built

All three tasks were already implemented in commit `a9add2c` prior to this execution run. The plan was validated and confirmed complete.

### Task 04-03-01: Confirm brain workflow uses respondToWebhook node

Workflow inspection confirmed `brain_6KFFgjd26nF0kNCA.json` contains `n8n-nodes-base.respondToWebhook | Respond` as the final node in the workflow chain. The n8n workflow side is correctly configured for per-turn synchronous responses.

Workflow node list:
- Brain Webhook In (webhook entry)
- Normalize Input, Resolve Config (preprocessing)
- Intent LLM (Ollama), Parse Intent (intent routing)
- Needs MCP? (conditional)
- RAG Lookup, Call MCP Gateway, Merge Context (context enrichment)
- Build Reply Context, Reply LLM (Ollama), Finalize Reply (LLM response)
- **Respond** (`respondToWebhook` — confirmed last node)

### Task 04-03-02: Demote execution API fallback and add explicit failure logging

`_run()` in `entrypoint.py` now has a two-tier except block:

1. `except APIStatusError` — re-raises immediately with an `ERROR`-level log message (`http_error=... — not falling back to execution API`). n8n was reachable but rejected the request; falling back cannot help.
2. `except Exception` — logs `ERROR`-level warning naming the fallback path before proceeding (`error=... — falling back to execution API (last resort, unreliable for per-turn flow)`).

The `_run_execution_api` method received a header comment block documenting it as a last-resort path requiring `N8N_API_KEY` that is not suitable for production per-turn latency.

### Task 04-03-03: Add explicit logging when n8n returns empty answer

Before `raise APIConnectionError("n8n webhook returned empty answer")` in `_run_webhook`, an `ERROR`-level log now records the raw response (first 500 chars) and instructs operators to confirm the `Respond to Webhook` node returns `{replyText}`.

## Verification Results

```
syntax ok
602: "N8N response path=webhook http_error=%s — not falling back to execution API",
609: "N8N response path=webhook error=%s — falling back to execution API (last resort, unreliable for per-turn flow)",
664:     "Check that the n8n workflow has a 'Respond to Webhook' node that returns {replyText}. "
```

All acceptance criteria met:
- respondToWebhook node confirmed in workflow JSON
- APIStatusError re-raised without fallback
- Connection errors logged before fallback
- Empty-answer 200 responses log raw body
- Python syntax check passes

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 04-03-01 | a9add2c | feat(voice-agent): demote execution API fallback, improve n8n error logging |
| 04-03-02 | a9add2c | (same commit) |
| 04-03-03 | a9add2c | (same commit) |

## Deviations from Plan

None — plan executed exactly as written. All changes were already present in the codebase prior to this execution run (committed in `a9add2c`). Plan was validated and confirmed complete.

## Self-Check: PASSED

- File exists: `apps/voice-agent/src/voice_agent/entrypoint.py` — FOUND
- Commit `a9add2c` exists in git log — FOUND
- Syntax check: PASSED
- All grep verification checks: PASSED
