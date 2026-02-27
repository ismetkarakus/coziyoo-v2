# Coziyoo Agent Python (Local Dev)

This is a standalone LiveKit Python agent service, intentionally isolated from the existing `agent/` and `agent-runtime/` code paths.

## Prerequisites

- `uv` installed
- LiveKit server reachable at `https://livekit.coziyoo.com/`
- Optional: LiveKit CLI `lk` for manual dispatch commands

## Environment

`agent-python/.env.local` is prefilled for local development:

```env
LIVEKIT_URL=https://livekit.coziyoo.com/
LIVEKIT_API_KEY=coziyoo_key
LIVEKIT_API_SECRET=coziyoo_super_secret_very_long
AGENT_NAME=coziyoo-python-agent
```

## Run locally

```bash
cd agent-python
uv sync
uv run python src/agent.py download-files
uv run python src/agent.py dev
```

## Manual dispatch test

In another terminal:

```bash
lk dispatch create \
  --agent-name coziyoo-python-agent \
  --room test-room \
  --metadata '{"source":"local-dev"}'
```

Join `test-room` from your client app and verify the agent joins/responds with voice.

## Production note

This folder is local-first for now and not deployed to Coolify in this phase.
