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
| 1 | - | - | - | - | - |
| 2 | - | - | - | - | - |
| 3 | - | - | - | - | - |
| 4 | - | - | - | - | - |
| 5 | - | - | - | - | - |

## Completion Rule

When all pass criteria are met, mark roadmap item `02-02` as complete and update `.planning/STATE.md` last activity with test evidence summary.
