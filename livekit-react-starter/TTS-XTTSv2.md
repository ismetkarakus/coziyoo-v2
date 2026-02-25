# XTTS API Server Usage Guide

This document explains how the system works internally, what API endpoints exist, and what request/response keys you need.

## 1. How the system works

### 1.1 Runtime flow
1. You start the server with `python -m xtts_api_server` and optional CLI flags.
2. `xtts_api_server/__main__.py` converts CLI flags into environment variables.
3. `xtts_api_server/server.py` reads those env vars, initializes `TTSWrapper`, and loads the model.
4. FastAPI endpoints call wrapper methods in `xtts_api_server/tts_funcs.py`.
5. Audio is generated and either:
- returned directly as a WAV file (`/tts_to_audio/`, `/tts_stream`), or
- saved to disk and path returned (`/tts_to_file`).

### 1.2 Model modes (`--model-source`)
- `local`: Uses XTTS local model class (`Xtts`) and local inference.
- `apiManual`: Uses Coqui `TTS(...).tts_to_file` with a manually downloaded model version.
- `api`: Uses latest model from `tts_models/multilingual/multi-dataset/xtts_v2`; ignores custom version flag.

### 1.3 Folder structure (defaults)
- Speakers: `speakers/`
- Output: `output/`
- Models: `models/` (or `xtts_models/` if started via `__main__.py` default)

The server creates missing directories automatically.

### 1.4 Caching behavior (`--use-cache`)
- Cache metadata file: `<output_folder>/cache.json`
- Cache key is based on cleaned text + speaker + language.
- If cache hit exists, generation is skipped and cached file path is reused.
- With cache disabled, `/tts_to_audio/` schedules generated temp output for deletion after response.

### 1.5 Low VRAM behavior (`--lowvram`)
- Model moves between CPU and CUDA around generation.
- This reduces VRAM usage at cost of potential latency.

### 1.6 Streaming modes
- HTTP stream endpoint: `/tts_stream` (only when `model_source == local`).
- Local playback streaming mode (`--streaming-mode`, `--streaming-mode-improve`) uses RealtimeTTS and plays audio locally on server machine.
- In streaming mode, `/tts_to_audio/` returns a 1-second silence WAV by design while playback happens locally.

## 2. API keys and authentication

### 2.1 API key support
There is **no built-in API key/authentication layer** in this codebase.

- No `Authorization`/Bearer token checks.
- No `X-API-Key` header checks.
- CORS is open (`allow_origins=["*"]`).

### 2.2 Security implication
If exposed publicly, anyone who can reach the server can call generation endpoints.

Recommended protection in production:
- Run behind a reverse proxy (Nginx/Caddy/Traefik).
- Add auth at proxy level (basic auth, JWT, mTLS, API key plugin, etc.).
- Restrict network exposure (`localhost` or private network only).

## 3. Supported language keys

Valid `language` codes:
- `ar`, `pt`, `zh-cn`, `cs`, `nl`, `en`, `fr`, `de`, `it`, `pl`, `ru`, `es`, `tr`, `ja`, `ko`, `hu`, `hi`

If the language key is invalid, endpoints return HTTP 400.

## 4. Endpoint reference

Base URL examples:
- Local default: `http://localhost:8020`
- Swagger UI: `http://localhost:8020/docs`

### 4.1 `GET /speakers_list`
Returns list of speaker names.

Response:
```json
["female", "male", "my_voice"]
```

### 4.2 `GET /speakers`
Returns speaker metadata in SillyTavern-friendly format.

Response keys:
- `name`
- `voice_id`
- `preview_url`

### 4.3 `GET /languages`
Returns language mapping.

Response shape:
```json
{
  "languages": {
    "Arabic": "ar",
    "English": "en"
  }
}
```

### 4.4 `GET /get_folders`
Returns current folder settings.

Response keys:
- `speaker_folder`
- `output_folder`
- `model_folder`

### 4.5 `GET /get_models_list`
Returns directory names inside model folder.

### 4.6 `GET /get_tts_settings`
Returns current generation settings.

Response keys:
- `temperature` (0.01 to 1)
- `speed` (0.2 to 2)
- `length_penalty` (float)
- `repetition_penalty` (0.1 to 10)
- `top_p` (0.01 to 1)
- `top_k` (1 to 100)
- `enable_text_splitting` (bool)
- `stream_chunk_size` (20 to 400)

### 4.7 `GET /sample/{file_name:path}`
Returns WAV sample from speaker folder.

- Blocks `..` path traversal attempts.
- Returns 404 if not found.

### 4.8 `POST /set_output`
Set output folder.

Request JSON keys:
- `output_folder` (string, existing directory)

Response:
```json
{"message":"Output folder set to /path/to/output"}
```

### 4.9 `POST /set_speaker_folder`
Set speaker folder.

Request JSON keys:
- `speaker_folder` (string, existing directory)

### 4.10 `POST /switch_model`
Switch currently loaded model.

Request JSON keys:
- `model_name` (must be folder name inside model folder and not current model)

400 examples:
- same model already loaded
- model folder does not exist

### 4.11 `POST /set_tts_settings`
Apply generation settings.

Request JSON keys:
- `stream_chunk_size`: int (20..400)
- `temperature`: float (0.01..1)
- `speed`: float (0.2..2)
- `length_penalty`: float
- `repetition_penalty`: float (0.1..10)
- `top_p`: float (0.01..1)
- `top_k`: int (1..100)
- `enable_text_splitting`: bool

### 4.12 `GET /tts_stream`
HTTP WAV chunk streaming response.

Query keys:
- `text` (string)
- `speaker_wav` (speaker name, relative wav path, or absolute wav path)
- `language` (supported language code)

Notes:
- Works only when `model_source == local`.
- Returns `audio/x-wav` stream.

### 4.13 `POST /tts_to_audio/`
Generate speech and return WAV file directly.

Request JSON keys:
- `text` (string)
- `speaker_wav` (speaker name/path)
- `language` (supported code)

Response:
- Normal mode: WAV file (`audio/wav`)
- Streaming mode flags enabled: silence WAV hack file (`silence.wav`) while playback is done locally

### 4.14 `POST /tts_to_file`
Generate speech and save to a path.

Request JSON keys:
- `text` (string, or path to `.txt` file)
- `speaker_wav` (speaker name/path)
- `language` (supported code)
- `file_name_or_path` (filename or absolute path)

Response keys:
- `message`
- `output_path`

## 5. Request key details

### 5.1 `speaker_wav` accepted values
- Speaker name without extension, e.g. `female`
- Relative wav filename in speakers folder, e.g. `female.wav`
- Absolute path to wav, e.g. `/data/voices/female.wav`
- Multi-sample speaker folder name (folder containing multiple wavs)

### 5.2 `text` accepted values
- Plain text string to synthesize
- Path to `.txt` file; server reads file contents and synthesizes that content

### 5.3 `file_name_or_path` behavior
- If absolute path: used as-is.
- If filename/relative path: saved under `output_folder`.

## 6. Example API usage

### 6.1 Generate and download audio
```bash
curl -X POST "http://localhost:8020/tts_to_audio/" \
  -H "Content-Type: application/json" \
  -d '{
    "text":"Hello from XTTS API server.",
    "speaker_wav":"female",
    "language":"en"
  }' \
  --output out.wav
```

### 6.2 Generate to server file path
```bash
curl -X POST "http://localhost:8020/tts_to_file" \
  -H "Content-Type: application/json" \
  -d '{
    "text":"Saving this on server disk.",
    "speaker_wav":"female",
    "language":"en",
    "file_name_or_path":"saved_sample.wav"
  }'
```

### 6.3 Update generation settings
```bash
curl -X POST "http://localhost:8020/set_tts_settings" \
  -H "Content-Type: application/json" \
  -d '{
    "stream_chunk_size":100,
    "temperature":0.75,
    "speed":1.0,
    "length_penalty":1.0,
    "repetition_penalty":5.0,
    "top_p":0.85,
    "top_k":50,
    "enable_text_splitting":true
  }'
```

## 7. Operational notes

- Model may download on first run if not present.
- In `local` mode, speaker latents are precomputed for known speakers unless low-vram mode is active.
- If you expose this service beyond localhost, add external auth and network controls.
- Best voice quality usually comes from clean mono 22.05kHz sample clips.

## 8. Key files in this repository

- Server entrypoint: `xtts_api_server/__main__.py`
- API routes: `xtts_api_server/server.py`
- TTS logic and validation: `xtts_api_server/tts_funcs.py`
- Container setup: `docker/Dockerfile`, `docker/docker-compose.yml`
