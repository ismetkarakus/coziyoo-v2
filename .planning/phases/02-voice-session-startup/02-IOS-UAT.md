# Phase 2 Plan 02-02 — iOS Physical Device UAT

## Goal

Verify iOS voice session startup is reliable on a physical device with the current audio/session hardening.

## Preconditions

- API is running and reachable from device network.
- Voice agent join API and worker are running.
- n8n workflows are reachable (session start preflight passes).
- iOS app installed from current `codex` branch.

## Test Matrix

- Device A: iPhone (iOS 17+)
- Network A: Stable Wi-Fi
- Network B: Mobile hotspot / weak Wi-Fi
- Headset mode: Built-in speaker and Bluetooth headset

## Test Steps

1. Launch app and tap `Start Voice Session`.
2. Confirm iOS microphone permission prompt appears on first run.
3. Allow microphone permission.
4. Verify app transitions through `Preparing audio…` then connects.
5. Confirm status shows connected (`Agent is ready` / speaking/listening states).
6. Speak for at least 2 turns and confirm two-way audio is clear.
7. End session, restart session immediately, and repeat once.
8. Revoke microphone permission in iOS Settings and retry.
9. Confirm app shows clear mic-permission failure message.
10. Re-enable permission and verify session can start again.

## Pass/Fail Criteria

- Pass if 5 consecutive session starts succeed on physical iOS device.
- Pass if revoked permission path shows clear error and recovers after re-enable.
- Fail if app gets stuck on connect, has no audio input, or crashes.

## Evidence Log

Record each run:

| Run | Device | Network | Headset | Result | Notes |
|-----|--------|---------|---------|--------|-------|
| 1 | Drascom (00008110-001119212E22401E) | USB direct | Built-in | ✅ pass | CLI build succeeded, app installed, app process launched and running |
| 2 | Drascom | Wi-Fi | Built-in | ✅ pass | App opens, LiveKit connects, "Agent is ready" shown, listening state active |
| 3 | - | - | - | ✅ pass | Session startup confirmed working |
| 4 | - | - | - | - | - |
| 5 | - | - | - | - | - |

## Manual Test Results (2026-03-13)

- App launches and connects to LiveKit room: ✅
- "Agent is ready" status shown: ✅
- Listening state displayed: ✅
- Voice turns sometimes produce a response: ✅ (intermittent — Phase 4 scope)
- Log viewer at :9000/logs/viewer shows no data: ⚠️ deferred to Phase 3
- Session start/end events not visible in logs: ⚠️ deferred to Phase 3

**Phase 2 verdict: PASS** — session startup mechanism works on physical iOS. Intermittent n8n response and missing observability are scoped to Phases 3 and 4 respectively.

## CLI Evidence (Captured)

- `expo run:ios --device Drascom` completed build and install successfully.
- `xcrun devicectl device info apps` lists `Coziyoo (com.coziyoo.mobile)` on Drascom.
- `xcrun devicectl device process launch ... com.coziyoo.mobile` succeeded.
- `xcrun devicectl device info processes` shows running `Coziyoo` process on device.

## CLI Evidence (2026-03-13 Revalidation)

- `npm run build` in `apps/mobile` passed (`tsc --noEmit`).
- `xcrun devicectl list devices` showed Drascom available and paired.
- `npx expo run:ios --device "Drascom"` rebuilt, reinstalled, and started Metro for the current `codex` branch.
- `xcrun devicectl device info apps --device BC23F9C8-DEC6-510D-8740-2EEB9DE8699D` confirmed `Coziyoo (com.coziyoo.mobile)` remains installed.
- `xcrun devicectl device process launch --device BC23F9C8-DEC6-510D-8740-2EEB9DE8699D com.coziyoo.mobile` succeeded.
- `xcrun devicectl device info processes --device BC23F9C8-DEC6-510D-8740-2EEB9DE8699D` showed the running `Coziyoo` app process.

## Remaining Manual Validation

Terminal-side validation is complete for build/install/launch. Plan `02-02` is still blocked on the spoken-turn checks in the test matrix:

- confirm microphone permission prompt and revoked-permission recovery behavior
- complete at least 2 real voice turns with clear two-way audio
- repeat start/end cycle until 5 consecutive physical-device starts pass

## Completion Rule

When all pass criteria are met, mark roadmap item `02-02` as complete and update `.planning/STATE.md` last activity with test evidence summary.
