---
phase: "04"
plan: "01"
subsystem: "security"
tags: ["security", "env-validation", "startup-guard", "voice-agent", "api"]
dependency_graph:
  requires: []
  provides: ["AI_SERVER_SHARED_SECRET required at startup on API and voice agent"]
  affects: ["apps/api/src/config/env.ts", "apps/voice-agent/src/voice_agent/entrypoint.py", "apps/voice-agent/src/voice_agent/join_api.py"]
tech_stack:
  added: []
  patterns: ["fail-fast startup validation", "Zod required field (no .optional())"]
key_files:
  created: []
  modified:
    - "apps/voice-agent/.env.example"
decisions:
  - "All three enforcement points were already implemented before plan execution; only .env.example placeholder text needed updating"
metrics:
  duration: "5 minutes"
  completed: "2026-03-16"
---

# Phase 4 Plan 01: Require AI_SERVER_SHARED_SECRET at Startup - Summary

**One-liner:** AI_SERVER_SHARED_SECRET enforced as required (min 16 chars) at startup in API Zod schema, voice agent worker main(), and join API module load.

## What Was Done

All three enforcement points were already implemented in the codebase prior to this plan's execution:

1. **API env schema** (`apps/api/src/config/env.ts` line 46): `AI_SERVER_SHARED_SECRET: z.string().min(16)` — required, no `.optional()`. The API already fails with a startup error if this variable is missing or too short.

2. **Voice agent worker** (`apps/voice-agent/src/voice_agent/entrypoint.py` lines 1172-1178): `main()` already validates the secret after `_configure_logging()` and calls `sys.exit(1)` with a `logger.critical` message. `sys` was already imported.

3. **Voice agent join API** (`apps/voice-agent/src/voice_agent/join_api.py` lines 18-23): Module-level guard already raises `RuntimeError` before `app = FastAPI(...)` if the secret is missing or shorter than 16 characters.

4. **`.env.example` placeholder** (`apps/voice-agent/.env.example`): Updated from `change_me_strong_secret` to `change_me_to_a_strong_secret_here` to make the requirement clearer to operators.

## Verification Results

```
grep "AI_SERVER_SHARED_SECRET" apps/api/src/config/env.ts
# AI_SERVER_SHARED_SECRET: z.string().min(16),

npm run build:api  # Clean build, no TypeScript errors

python -m py_compile src/voice_agent/entrypoint.py  # entrypoint syntax ok
python -m py_compile src/voice_agent/join_api.py     # join_api syntax ok
```

## Deviations from Plan

### Auto-observed: Tasks 1 and 2 already implemented

**Found during:** Initial file inspection
**Issue:** Tasks 04-01-01 and 04-01-02 were already implemented in the codebase. The API schema was already non-optional, and both voice agent files already had the startup validation guards.
**Action:** Verified existing implementation matches plan specification exactly. Only executed Task 04-01-03 (env.example update).
**Commits:** fab9a3f

## Self-Check: PASSED

- [x] `apps/voice-agent/.env.example` updated with descriptive placeholder
- [x] `apps/api/src/config/env.ts` has `z.string().min(16)` (no `.optional()`)
- [x] `entrypoint.py` has `sys.exit(1)` guard in `main()`
- [x] `join_api.py` has `RuntimeError` guard at module level
- [x] Commit `fab9a3f` exists
- [x] API TypeScript build passes
- [x] Python syntax check passes for both files
