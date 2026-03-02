# Mobile Replatform Tasklist

## Completed
1. Created `apps/mobile` scaffold and core docs.
2. Replaced legacy app folders (`apps/web`, `apps/agent`).
3. Added API start-session metadata support for mobile context.
4. Created `apps/voice-agent` modular scaffold.

## In Progress
1. Harden mobile runtime integration with LiveKit RN native setup.
2. Connect DataChannel contract to telemetry/error reporting.

## Next
1. Add strong typed navigation params and route guards.
2. Add persisted secure token storage on mobile.
3. Add agent dispatch worker process manager in `apps/voice-agent`.
4. Implement real streaming STT/TTS providers in `apps/voice-agent`.
5. Add end-to-end tests across API + voice-agent + mobile harness.
6. Add deployment units for `apps/voice-agent` (`systemd` + health checks).
