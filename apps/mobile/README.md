# Coziyoo Mobile

Voice-first React Native client for Coziyoo using LiveKit realtime audio + DataChannel action control.

## Environment
Set these before running:

- `EXPO_PUBLIC_API_BASE_URL` (example: `https://api.coziyoo.com`)
- `EXPO_PUBLIC_DEFAULT_DEVICE_ID` (example: `mobile_dev_001`)

## Run

```bash
npm install
npm run dev --workspace=apps/mobile
```

## E2E Smoke

```bash
API_BASE_URL=https://api.coziyoo.com \
AGENT_API_BASE_URL=http://agent.coziyoo.com:9000 \
E2E_EMAIL=admin@coziyoo.com \
E2E_PASSWORD=Admin12345 \
npm run e2e:voice-smoke --workspace=apps/mobile
```

## Notes

- App uses `/v1/auth/login` for auth and `/v1/livekit/session/start` for voice bootstrap.
- Agent actions are accepted only through strict JSON schema in `src/features/actions/schema.ts`.
- Keep UI action handlers allowlisted in `src/features/actions/dispatcher.ts`.
- Auth tokens are persisted with Expo Secure Store.
- Voice/action telemetry is posted to `/v1/livekit/mobile/telemetry`.
