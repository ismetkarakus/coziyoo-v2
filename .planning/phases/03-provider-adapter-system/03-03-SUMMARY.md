---
phase: 03-provider-adapter-system
plan: 03
subsystem: api
tags: [entrypoint, wiring, adapter-integration]
requires:
  - phase: 03-provider-adapter-system
    provides: providers adapter factories and parser module
provides:
  - entrypoint delegation to parse_* + build_* providers module
  - integration tests for old/new schema wiring paths
affects: [runtime-call-path, phase-04-logs]
tech-stack:
  added: [none]
  patterns: [entrypoint orchestration delegates provider construction]
key-files:
  created:
    - apps/voice-agent/tests/test_entrypoint_wiring.py
  modified:
    - apps/voice-agent/src/voice_agent/entrypoint.py
key-decisions:
  - "N8N LLM path remains unchanged; only OpenAI fallback path moved to adapter module."
  - "Entrypoint keeps env fallbacks but now applies typed config normalization first."
requirements-completed: [ADAPT-01, ADAPT-02, ADAPT-03, ADAPT-04, ADAPT-05]
duration: 20min
completed: 2026-03-22
---

# Phase 3 Plan 03: Entrypoint Wiring Summary

**Refactored entrypoint provider builders to delegate through the new adapter module while preserving existing N8N-first behavior.**

## Task Commits
1. `9c71e38` feat(03-provider-adapter-system-03): wire entrypoint builders to providers adapter module

## Verification
- `python -m pytest tests/test_entrypoint_wiring.py tests/test_adapters.py -x -v --timeout=30` -> `19 passed`.
- Provider import checks pass:
  - `from voice_agent.providers import ...` OK
  - `from voice_agent.entrypoint import _build_stt, _build_llm, _build_tts` OK
- No `from .providers.http_` imports remain in `entrypoint.py`.

## Deviations from Plan
- Full `tests/` suite target is not fully green due pre-existing unrelated import error:
  - `tests/test_dispatch_manager.py` -> `ModuleNotFoundError: voice_agent.dispatch`
  - Left unchanged (out-of-scope baseline issue).

## Self-Check: PASSED
