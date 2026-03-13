# Coziyoo Voice Agent

LiveKit Agents runtime for Coziyoo voice sessions with modular STT/LLM/TTS providers and deterministic UI action output.

## Runtime
- Agent worker entrypoint: `voice_agent.entrypoint`
- Agent dispatch API: `voice_agent.join_api`

## Env
Use repo-root env files as single source of truth:
- local Docker/dev: root `.env.local`
- non-Docker/runtime scripts: root `.env`

## Install
```bash
cd apps/voice-agent
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Run
Agent join API (port 9000):
```bash
uvicorn voice_agent.join_api:app --host 0.0.0.0 --port 9000
```

Dispatch status:
```bash
curl http://127.0.0.1:9000/livekit/agent-session/<task-id>
```

Agent worker:
```bash
python -m voice_agent.entrypoint
```
