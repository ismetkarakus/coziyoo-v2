# Coziyoo LiveKit React Starter

Standalone React app for end-to-end testing:

- admin login
- `session/start` call (room create + user token + room-scoped single agent dispatch)
- LiveKit room join
- text chat through `agent/chat` (Ollama-backed on API side)
- voice input through `stt/transcribe` (speech server-backed on API side)

## Env

Create `.env` from `.env.example`:

- `VITE_API_BASE_URL=https://api.coziyoo.com`
- `VITE_AUTH_API_BASE_URL=https://api.coziyoo.com` (optional, login endpoint base)

## Run

```bash
npm ci
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Coolify

Create a separate service with base directory: `livekit-react-starter`

- Install: `npm ci`
- Build: `npm run build`
- Publish directory: `dist`

Set env:

- `VITE_API_BASE_URL=https://api.yourdomain.com`
