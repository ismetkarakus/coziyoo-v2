# Chatterbox TTS API Endpoints

This document describes the FastAPI endpoints implemented in `server.py` for the Chatterbox TTS server.

## Base URL

- host (default): `https://voice.drascom.uk`
- Docker host mapping (from your running container): `http://<server-ip>:8004`

## Main TTS Endpoints

### 1) POST `/tts`
Generate speech with custom voice mode and generation controls.

- Content-Type: `application/json`
- Response: audio stream (`audio/wav` or `audio/opus`)
- Success: `200`
- Common errors: `400`, `404`, `500`, `503`

Request body fields (`CustomTTSRequest`):

- `text` (string, required)
- `voice_mode` (`predefined` | `clone`, default `predefined`)
- `predefined_voice_id` (string, required when `voice_mode=predefined`)
- `reference_audio_filename` (string, required when `voice_mode=clone`)
- `output_format` (`wav` | `opus`, default `wav`)
- `split_text` (bool, default `true`)
- `chunk_size` (int, default `120`, range `50-500`)
- `temperature` (float, optional, range `0.1-1.5`)
- `exaggeration` (float, optional)
- `cfg_weight` (float, optional)
- `seed` (int, optional)
- `speed_factor` (float, optional)
- `language` (string, optional)

Example (predefined voice):

```bash
curl -X POST "http://localhost:8004/tts" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello from Chatterbox.",
    "voice_mode": "predefined",
    "predefined_voice_id": "Gianna.wav",
    "output_format": "wav",
    "split_text": true,
    "chunk_size": 120,
    "temperature": 0.8,
    "exaggeration": 0.5,
    "cfg_weight": 0.5,
    "seed": 42,
    "speed_factor": 1.0,
    "language": "en"
  }' \
  --output tts.wav
```

Example (clone mode):

```bash
curl -X POST "http://localhost:8004/tts" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "This uses a cloned voice.",
    "voice_mode": "clone",
    "reference_audio_filename": "serdar.mp3",
    "output_format": "opus"
  }' \
  --output tts.opus
```

### 2) POST `/v1/audio/speech` (OpenAI-compatible)
OpenAI-style speech endpoint.

- Content-Type: `application/json`
- Response: audio stream (`wav`, `opus`, or `mp3`)
- Success: `200`
- Common errors: `404`, `500`, `503`

Request body fields (`OpenAISpeechRequest`):

- `model` (string, required)
- `input` (string, required)
- `voice` (string, required): filename searched first in `voices/`, then `reference_audio/`
- `response_format` (`wav` | `opus` | `mp3`, default `wav`)
- `speed` (float, default `1.0`)
- `seed` (int, optional)

Example:

```bash
curl -X POST "http://localhost:8004/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "chatterbox",
    "input": "OpenAI compatible endpoint test.",
    "voice": "Gianna.wav",
    "response_format": "mp3",
    "speed": 1.0,
    "seed": 7
  }' \
  --output speech.mp3
```

## File Management Endpoints

### 3) POST `/upload_reference`
Upload one or more reference audio files for clone mode.

- Content-Type: `multipart/form-data`
- Form field: `files` (repeatable)
- Allowed extensions: `.wav`, `.mp3`

Example:

```bash
curl -X POST "http://localhost:8004/upload_reference" \
  -F "files=@/path/to/voice1.wav" \
  -F "files=@/path/to/voice2.mp3"
```

### 4) POST `/upload_predefined_voice`
Upload one or more predefined voices.

- Content-Type: `multipart/form-data`
- Form field: `files` (repeatable)
- Allowed extensions: `.wav`, `.mp3`

Example:

```bash
curl -X POST "http://localhost:8004/upload_predefined_voice" \
  -F "files=@/path/to/new_voice.wav"
```

## UI Helper Endpoints

### 5) GET `/api/ui/initial-data`
Returns configuration and UI bootstrap data.

### 6) GET `/get_reference_files`
Returns list of reference audio filenames.

### 7) GET `/get_predefined_voices`
Returns predefined voice metadata list.

### 8) GET `/api/model-status`
Returns model load/availability status.

## Configuration Endpoints

### 9) POST `/save_settings`
Save partial config updates (`config.yaml`).

### 10) POST `/reset_settings`
Reset config to defaults.

### 11) POST `/restart_server`
Returns restart instruction/status message.

## UI Route

### 12) GET `/`
Serves the web UI.

## Interactive API Docs

- Swagger UI: `http://localhost:8004/docs`
- ReDoc: `http://localhost:8004/redoc`

## Notes

- If model is not loaded, TTS endpoints return `503`.
- `voice_mode=predefined` requires `predefined_voice_id`.
- `voice_mode=clone` requires `reference_audio_filename`.
- Audio is returned as a binary stream. Use `--output <file>` in `curl`.
