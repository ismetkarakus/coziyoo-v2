# Voice Selling Assistant Implementation Plan

## Goals

1. Build dedicated `apps/agent` app with login, settings, and home pages.
2. Keep voice pipeline modular for STT, TTS, and LLM providers.
3. Use API-minted per-session LiveKit tokens.
4. Support remote speech server STT, selectable TTS engine, and remote Ollama model.
5. Integrate n8n through reusable API service module.

## Architecture

- Frontend app in `apps/agent` (React + Vite + TS)
- API endpoints for auth, settings, session start
- Agent runtime on `agent.coziyoo.com:9000`
- LiveKit orchestration via `/v1/livekit/session/start`

## Integration model

- STT provider: `remote-speech-server`
- TTS providers: `f5-tts`, `xtts`, `chatterbox`
- LLM provider: remote Ollama
- n8n status/tool workflows via API service abstraction

## Deliverables

1. New agent app workspace
2. Settings UI linked from login (pre-login)
3. Session start workflow in home page
4. Backend modularization for n8n integration
5. Backend settings support for modular provider config fields
