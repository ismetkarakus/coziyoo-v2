---
phase: 3
slug: provider-adapter-system
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio (voice agent) |
| **Config file** | apps/voice-agent/pyproject.toml [tool.pytest.ini_options] — Wave 0 |
| **Quick run command** | `cd apps/voice-agent && python -m pytest tests/ -x --timeout=30` |
| **Full suite command** | `cd apps/voice-agent && python -m pytest tests/ -v --timeout=30` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** `cd apps/voice-agent && python -m pytest tests/ -x --timeout=30`
- **After every plan wave:** Full pytest suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Wave 0 Requirements

- [ ] `apps/voice-agent/tests/__init__.py` — make tests a package
- [ ] `apps/voice-agent/tests/conftest.py` — shared fixtures (mock metadata, mock provider configs)
- [ ] `apps/voice-agent/tests/test_adapters.py` — stub tests for ADAPT-01 through ADAPT-05
- [ ] `apps/voice-agent/pyproject.toml` — [tool.pytest.ini_options] section added
- [ ] `pip install pytest pytest-asyncio` — install into voice agent venv

*Wave 0 must complete before Wave 1 adapter tasks begin.*

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| wave0-setup | 03-01 | 0 | ADAPT-01..05 | setup | `cd apps/voice-agent && python -m pytest tests/ -x` | ❌ W0 | ⬜ pending |
| adapter-module | 03-01 | 1 | ADAPT-01,02,03,04 | unit | `cd apps/voice-agent && python -m pytest tests/test_adapters.py -x` | ❌ W0 | ⬜ pending |
| response-remap | 03-01 | 1 | ADAPT-05 | unit | `cd apps/voice-agent && python -m pytest tests/test_adapters.py::test_response_remap -x` | ❌ W0 | ⬜ pending |
| entrypoint-wire | 03-01 | 2 | ADAPT-01..05 | integration | `cd apps/voice-agent && python -m pytest tests/ -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM call uses custom headers at runtime | ADAPT-02 | Requires live session + network capture | Start agent, trigger call, capture outgoing HTTP headers to LLM server |
| TTS custom endpoint path applied | ADAPT-04 | Requires live TTS server at custom path | Configure custom path in dashboard, trigger TTS, verify request hits correct URL |
| Non-OpenAI response remapped correctly | ADAPT-05 | Requires actual non-OpenAI provider | Configure a non-standard TTS/STT, verify transcription/audio still works |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
