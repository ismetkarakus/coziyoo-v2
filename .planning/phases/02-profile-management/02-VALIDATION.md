---
phase: 2
slug: profile-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (apps/api) + build verification (apps/voice-dashboard) |
| **Config file** | apps/api/vitest.config.ts (existing) |
| **Quick run command** | `npm run test --workspace=apps/api -- --run src/routes/__tests__/agent-profiles.test.ts` |
| **Full suite command** | `npm run test --workspace=apps/api -- --run && npm run build --workspace=apps/voice-dashboard` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run API route tests `npm run test --workspace=apps/api -- --run`
- **After every plan wave:** Run full suite (API tests + dashboard build)
- **Before `/gsd:verify-work`:** Full suite must be green + manual UI verification
- **Max feedback latency:** 60 seconds

---

## Wave 0 Requirements

- [ ] `apps/api/src/routes/__tests__/agent-profiles.test.ts` — CRUD route tests (create, read, update, delete, activate)
- [ ] `apps/voice-dashboard/package.json` — TanStack Query, React Hook Form, Zod, shadcn components installed

*Wave 0 must complete before Wave 1 feature tasks begin.*

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| db-schema | 02-01 | 0 | PROF-01..06 | integration | `npm run test --workspace=apps/api -- --run src/routes/__tests__/agent-profiles.test.ts` | ❌ W0 | ⬜ pending |
| api-crud | 02-01 | 1 | PROF-01,03,05 | integration | Same as above | ❌ W0 | ⬜ pending |
| api-clone | 02-01 | 1 | PROF-04 | integration | Same as above | ❌ W0 | ⬜ pending |
| api-test | 02-01 | 1 | VOICE-06,STT-06,TOOLS-04 | manual | Requires live servers | ✅ | ⬜ pending |
| deps-install | 02-02 | 0 | APP-01 | build | `npm run build --workspace=apps/voice-dashboard` | ✅ | ⬜ pending |
| sidebar | 02-02 | 1 | PROF-02,06 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| model-tab | 02-02 | 2 | MODEL-01..07 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| voice-tab | 02-02 | 2 | VOICE-01..06 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| stt-tab | 02-02 | 2 | STT-01..06 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| tools-tab | 02-02 | 2 | TOOLS-01..05 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| curl-import | 02-03 | 3 | TOOLS-05 | build | `npm run build --workspace=apps/voice-dashboard` | ❌ W0 | ⬜ pending |
| connection-test | 02-03 | 3 | VOICE-06,STT-06,TOOLS-04 | manual | Requires live servers + browser | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| TTS audio plays in browser | VOICE-06 | Requires live TTS server + browser audio | Open Voice tab, enter TTS config, click test, verify audio plays |
| STT mic transcription | STT-06 | Requires browser mic + live STT server | Open Transcriber tab, click test, speak, verify transcription appears |
| N8N ping shows success/fail | TOOLS-04 | Requires live N8N instance | Open Tools tab, enter webhook URL, click test, verify green/red feedback |
| Active profile used by voice call | PROF-05 | Requires LiveKit session | Activate profile, trigger voice call from mobile app, verify config was applied |
| Profile data persists on reload | MODEL-01..07 | Browser state verification | Fill all fields, save, reload page, verify all values present |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
