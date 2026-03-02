# Voice Agent Plan

## Objective
Provide a modular LiveKit Agents runtime that supports pluggable STT/LLM/TTS, deterministic action outputs, and API-driven lifecycle callbacks.

## Modules
1. `config/`: environment and runtime settings.
2. `providers/stt`: remote speech server adapters.
3. `providers/llm`: Ollama/OpenAI-compatible adapters.
4. `providers/tts`: streaming TTS adapters.
5. `actions/`: schema and DataChannel emission.
6. `tools/`: sales/business tools.
7. `session/`: end-of-call summarization and API callback.
8. `join_api.py`: agent dispatch control endpoint.
9. `entrypoint.py`: LiveKit worker entrypoint.
