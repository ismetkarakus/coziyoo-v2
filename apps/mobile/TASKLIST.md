# Mobile Replatform Tasklist

## Completed
1. Created `apps/mobile` scaffold and core docs.
2. Replaced legacy app folders (`apps/web`, `apps/agent`).
3. Added API start-session metadata support for mobile context.
4. Created `apps/voice-agent` modular scaffold.

## In Progress
1. Add robust runtime metrics and alerts for mobile reconnect quality in production.

## Next
1. Harden LiveKit native runtime behavior under real mobile network transitions.

## Newly Completed
1. Added strong typed navigation params and route-safe screen props.
2. Added persisted secure token storage on mobile (Expo Secure Store).
3. Connected DataChannel/voice lifecycle to telemetry endpoint reporting.
4. Added agent dispatch worker process manager scaffold in `apps/voice-agent`.
5. Replaced placeholder TTS adapter with remote TTS provider module.
6. Added deployment scripts and systemd units for `apps/voice-agent` API and worker services.
7. Added executable E2E voice smoke harness spanning API + voice-agent dispatch flow.
8. Hardened LiveKit mobile session lifecycle with connect retry/backoff, startup timeout, and safer teardown.
