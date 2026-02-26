# Assistant Runtime Config Contract

This folder defines the expected global speech/runtime config contract for the external AI server assistant.

- `config.json` is a template contract for assistant-native audio mode.
- Runtime ownership is on the assistant service (external repo), not the API service.
- Do not commit real secrets in this file.

Expected top-level sections:
- `stt`: provider and transcription settings.
- `tts`: engine/provider synthesis settings.
- `llm`: optional model provider settings.
