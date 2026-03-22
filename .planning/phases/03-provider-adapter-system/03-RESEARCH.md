# Phase 3: Provider Adapter System - Research

**Researched:** 2026-03-22
**Domain:** Python voice agent provider architecture (LiveKit Agents SDK + OpenAI-compatible APIs)
**Confidence:** HIGH

## Summary

The current voice agent already uses a provider abstraction -- three `_build_*` functions (`_build_stt`, `_build_llm`, `_build_tts`) that read config from `ctx.job.metadata.providers` and instantiate either custom HTTP adapters (`HttpSTT`, `HttpTTS`) or the `livekit-plugins-openai` OpenAI-compatible client (`LLM`, `STT`, `TTS`). The N8N LLM path bypasses OpenAI entirely with a custom `N8nLLM` class.

The ADAPT requirements ask for a unified OpenAI-compatible base client with pluggable adapters that apply custom headers, body params, endpoint paths, and response field remapping. The key insight from codebase analysis: the `livekit-plugins-openai` v1.4.4 LLM class already supports `extra_headers`, `extra_body`, and `extra_query` parameters natively. The TTS and STT OpenAI plugins accept `base_url` and `api_key` but do NOT expose `extra_headers`/`extra_body` -- they use raw `openai.AsyncClient` under the hood, so custom headers/body must be applied via a custom `httpx.AsyncClient` or by wrapping the plugin.

The recommended approach: refactor `_build_stt`, `_build_llm`, `_build_tts` to use a new adapter layer that (1) always starts from an OpenAI-compatible client, (2) applies profile-specific overrides (headers, body params, endpoint paths) from the metadata config, and (3) handles response field remapping for non-standard providers. The N8N LLM path remains separate since it is fundamentally not OpenAI-compatible.

**Primary recommendation:** Create an adapter module (`providers/adapters.py`) with config dataclasses and factory functions that wrap the OpenAI plugin classes with profile-driven overrides, replacing the current ad-hoc `_build_*` functions.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ADAPT-01 | Voice agent uses OpenAI-compatible client as base for all LLM, TTS, STT | LiveKit OpenAI plugin (v1.4.4) is already installed and used for LLM fallback. Extend to be primary for all three services. Custom HttpTTS/HttpSTT adapters handle non-OpenAI servers. |
| ADAPT-02 | Adapters can override request headers | LLM plugin supports `extra_headers` natively. TTS/STT plugins need custom `httpx.AsyncClient` with `default_headers` injection, or use HttpTTS/HttpSTT which already accept `auth_header`. |
| ADAPT-03 | Adapters can override body params | LLM plugin supports `extra_body` natively. TTS plugin has `speed`, `voice`, `model` but no generic extra_body. HttpTTS already accepts `body_params`. |
| ADAPT-04 | Adapters can override endpoint paths | HttpSTT already supports `transcribe_path`, HttpTTS supports `synth_path`. OpenAI plugin uses fixed `/v1/chat/completions`, `/v1/audio/speech`, `/v1/audio/transcriptions` but base_url can include path prefix. |
| ADAPT-05 | Adapters can remap request/response fields for non-OpenAI shapes | HttpSTT already handles `text` vs `transcript` response fields. HttpTTS has `text_field_name`. Need a general response remapping layer. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| livekit-agents | 1.4.5 | Agent framework, base STT/TTS/LLM classes | Already installed, provides AgentSession |
| livekit-plugins-openai | 1.4.4 | OpenAI-compatible LLM, STT, TTS | Already installed, natively supports base_url/api_key/extra_headers/extra_body for LLM |
| aiohttp | >=3.10.0 | HTTP client for custom adapters (HttpTTS, HttpSTT, N8nLLM) | Already used throughout |
| pydantic | >=2.10.6 | Config validation, adapter config models | Already used for action schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| httpx | (transitive via openai) | Custom HTTP client injection into OpenAI plugin | When overriding headers/timeouts on TTS/STT OpenAI plugins |

### No New Dependencies Required

All ADAPT requirements can be satisfied with existing installed packages. No new pip installs needed.

## Architecture Patterns

### Current Provider Architecture (As-Is)

```
entrypoint.py
  _build_stt(providers, language) -> HttpSTT or livekit.plugins.openai.STT
  _build_llm(providers, runtime_ctx) -> N8nLLM or LoggingLLM(livekit.plugins.openai.LLM)
  _build_tts(providers, language) -> HttpTTS

providers/
  http_stt.py  -> HttpSTT(STT)      # Custom aiohttp-based, multipart form
  http_tts.py  -> HttpTTS(TTS)      # Custom aiohttp-based, JSON body
  (no __init__.py exports)

Config flow:
  API resolveProviders(settings) -> JSON metadata -> ctx.job.metadata.providers
  providers = {"stt": {...}, "tts": {...}, "n8n": {...}}
  Note: NO separate "llm" key today -- LLM config is split between providers.llm and providers.n8n
```

### Target Provider Architecture (To-Be)

```
providers/
  __init__.py              # exports factory functions
  adapters.py              # AdapterConfig dataclass + apply_overrides()
  openai_llm_adapter.py    # Wraps livekit.plugins.openai.LLM with overrides
  openai_tts_adapter.py    # Wraps livekit.plugins.openai.TTS or falls back to HttpTTS
  openai_stt_adapter.py    # Wraps livekit.plugins.openai.STT or falls back to HttpSTT
  http_stt.py              # (existing, unchanged)
  http_tts.py              # (existing, unchanged)
  config.py                # ProviderConfig, LLMConfig, TTSConfig, STTConfig pydantic models

entrypoint.py
  _build_stt() -> calls providers.build_stt(config)
  _build_llm() -> calls providers.build_llm(config)
  _build_tts() -> calls providers.build_tts(config)
```

### Recommended Project Structure

```
apps/voice-agent/src/voice_agent/
  providers/
    __init__.py              # Re-exports: build_stt, build_llm, build_tts
    config.py                # Pydantic models for provider config from metadata
    adapter.py               # Core adapter logic: apply headers/body/path overrides
    openai_llm_adapter.py    # OpenAI LLM with adapter overrides
    openai_stt_adapter.py    # OpenAI STT with adapter overrides
    openai_tts_adapter.py    # OpenAI TTS with adapter overrides
    http_stt.py              # Existing HttpSTT (for non-OpenAI STT servers)
    http_tts.py              # Existing HttpTTS (for non-OpenAI TTS servers)
```

### Pattern 1: Config-Driven Factory

**What:** A single factory function per service type that reads a typed config and returns the appropriate provider instance with all overrides applied.

**When to use:** Every time a voice session starts (in entrypoint.py).

**Example:**
```python
# providers/config.py
from pydantic import BaseModel

class ServiceConfig(BaseModel):
    base_url: str = ""
    api_key: str = ""
    model: str = ""
    endpoint_path: str = ""          # ADAPT-04
    custom_headers: dict[str, str] = {}  # ADAPT-02
    custom_body_params: dict = {}        # ADAPT-03
    response_field_map: dict[str, str] = {}  # ADAPT-05

class LLMConfig(ServiceConfig):
    model: str = "llama3.1:8b"
    endpoint_path: str = "/v1/chat/completions"

class TTSConfig(ServiceConfig):
    voice: str = ""
    speed: float = 1.0
    endpoint_path: str = "/v1/audio/speech"
    text_field_name: str = "text"      # for non-OpenAI TTS
    engine: str = "f5-tts"

class STTConfig(ServiceConfig):
    language: str = "en"
    endpoint_path: str = "/v1/audio/transcriptions"
    response_format: str = "verbose_json"
```

### Pattern 2: OpenAI Plugin with Injected httpx Client

**What:** The `livekit-plugins-openai` TTS and STT classes accept a pre-configured `openai.AsyncClient`. We can construct that client with a custom `httpx.AsyncClient` that has default headers baked in.

**When to use:** When the profile specifies custom_headers for TTS or STT and the server is OpenAI-compatible.

**Example:**
```python
import httpx
import openai

def build_openai_client(
    base_url: str,
    api_key: str,
    extra_headers: dict[str, str] | None = None,
) -> openai.AsyncClient:
    """Build an openai.AsyncClient with custom default headers."""
    http_client = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=15.0, read=30.0, write=5.0, pool=5.0),
        follow_redirects=True,
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=50),
        headers=extra_headers or {},
    )
    return openai.AsyncClient(
        api_key=api_key,
        base_url=base_url,
        max_retries=0,
        http_client=http_client,
    )
```

### Pattern 3: Fallback Chain (OpenAI-first, HTTP-custom second)

**What:** For each service, try OpenAI-compatible plugin first. If the endpoint is non-standard (custom path, non-JSON response, multipart upload required for STT), fall back to the existing HttpSTT/HttpTTS.

**When to use:** In the build factory functions.

**Decision logic:**
```
For TTS:
  - If endpoint_path is /v1/audio/speech AND response is standard -> use OpenAI TTS plugin
  - Else (custom path like /tts, WAV response, custom body fields) -> use HttpTTS

For STT:
  - If endpoint_path is /v1/audio/transcriptions AND standard response -> use OpenAI STT plugin
  - Else -> use HttpSTT

For LLM:
  - If N8N config present -> use N8nLLM (unchanged)
  - Else -> use OpenAI LLM plugin with extra_headers/extra_body
```

### Pattern 4: Response Field Remapping (ADAPT-05)

**What:** Some providers return responses in non-OpenAI shapes. The adapter wraps the response and remaps fields.

**When to use:** When `response_field_map` is non-empty in the config.

**Current state:** HttpSTT already does basic remapping (checks `text` then `transcript`). This pattern formalizes it.

**Example:**
```python
def remap_response(response: dict, field_map: dict[str, str]) -> dict:
    """Remap response fields. field_map = {"provider_field": "openai_field"}"""
    if not field_map:
        return response
    remapped = dict(response)
    for src, dst in field_map.items():
        if src in remapped:
            remapped[dst] = remapped.pop(src)
    return remapped
```

### Anti-Patterns to Avoid

- **Replacing HttpTTS/HttpSTT entirely:** These handle WAV audio decoding, multipart form uploads, and non-OpenAI response shapes that the OpenAI plugin cannot handle. Keep them as the fallback for truly non-standard servers.
- **Modifying N8nLLM to be "OpenAI-compatible":** N8N webhooks are fundamentally different (webhook POST with custom payload, not chat completions). Keep N8nLLM separate.
- **Creating a new abstract base class hierarchy:** LiveKit already provides `TTS`, `STT`, `LLM` base classes. Don't create another layer of abstraction on top. Use composition (wrapping) instead.
- **Changing the metadata JSON structure in Phase 3:** Phase 2 defines the config shape. Phase 3 consumes it. Don't change the contract.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAI-compatible HTTP client | Custom aiohttp client for /v1/chat/completions | `livekit-plugins-openai` LLM class | Handles streaming, tool calls, retries, all chat completion edge cases |
| OpenAI-compatible TTS | Custom audio decode pipeline | `livekit-plugins-openai` TTS class (when server is OpenAI-compatible) | Handles MP3/PCM decoding, streaming, proper AudioFrame creation |
| Header injection | Monkey-patching aiohttp sessions | `httpx.AsyncClient(headers=...)` passed to `openai.AsyncClient(http_client=...)` | Clean, documented API |
| Config validation | Manual dict parsing | Pydantic models | Type safety, defaults, validation |

**Key insight:** The livekit-plugins-openai LLM class (v1.4.4) already has `extra_headers`, `extra_body`, and `extra_query` parameters. For LLM, ADAPT-02 and ADAPT-03 are almost free. The work is primarily in TTS/STT and the general adapter framework.

## Common Pitfalls

### Pitfall 1: OpenAI Plugin Fixed Endpoint Paths
**What goes wrong:** The OpenAI TTS plugin calls `/v1/audio/speech` and STT calls `/v1/audio/transcriptions` hardcoded internally. You cannot override the path via the plugin API.
**Why it happens:** The OpenAI Python SDK constructs paths internally.
**How to avoid:** For custom endpoint paths (ADAPT-04), either (a) use HttpTTS/HttpSTT which accept path parameters, or (b) set `base_url` to include the path prefix so that the SDK appends its fixed path to a modified base. For truly non-standard paths, use the HTTP adapters.
**Warning signs:** 404 errors from the provider when using OpenAI plugin with non-standard servers.

### Pitfall 2: TTS/STT Content Type Differences
**What goes wrong:** OpenAI TTS returns MP3 by default; non-OpenAI servers (f5-tts, xtts, chatterbox) return WAV. The OpenAI STT expects multipart form upload; some servers accept JSON.
**Why it happens:** Different providers implement different subsets of the OpenAI API.
**How to avoid:** The factory function must detect whether the server is truly OpenAI-compatible or needs the HTTP adapter. The `engine` field in TTS config and `provider` field in STT config serve as discriminators.
**Warning signs:** Audio playback garbled or silent (wrong codec assumption).

### Pitfall 3: Breaking the N8N LLM Path
**What goes wrong:** Attempting to route N8N through the OpenAI adapter breaks the webhook-based workflow.
**Why it happens:** N8N uses webhooks with custom payloads, not /v1/chat/completions.
**How to avoid:** Keep N8nLLM completely separate. The adapter system only applies when `n8n_config` is NOT the primary LLM path.
**Warning signs:** N8N requests going to wrong endpoint, missing workflow context.

### Pitfall 4: LiveKit Plugin Constructor Immutability
**What goes wrong:** Trying to modify headers/body after constructing the plugin instance.
**Why it happens:** The OpenAI plugin stores `_opts` and `_client` at construction time. You can't change `extra_headers` after init.
**How to avoid:** All overrides must be applied at construction time. The adapter pattern builds the fully-configured instance once per session.
**Warning signs:** Config changes not taking effect in live calls.

### Pitfall 5: Auth Header Format Inconsistency
**What goes wrong:** Config stores `authHeader` as "Bearer sk-xxxx" but OpenAI client expects just the API key "sk-xxxx".
**Why it happens:** The existing code has two patterns: `auth_header` (full header value) for HTTP adapters, and `api_key` (just the key) for OpenAI plugin.
**How to avoid:** The adapter config should normalize: accept `api_key` and `custom_headers` separately. If custom_headers includes `Authorization`, it takes precedence.

## Code Examples

### Example 1: LLM Factory with Adapter Overrides

```python
# providers/openai_llm_adapter.py
from livekit.plugins.openai import LLM as OpenAILLM
from .config import LLMConfig

def build_openai_llm(config: LLMConfig) -> OpenAILLM:
    """Build OpenAI-compatible LLM with profile overrides."""
    kwargs = {
        "model": config.model,
        "api_key": config.api_key or "no-key",
        "base_url": config.base_url,
    }
    if config.custom_headers:
        kwargs["extra_headers"] = config.custom_headers
    if config.custom_body_params:
        kwargs["extra_body"] = config.custom_body_params

    return OpenAILLM(**kwargs)
```

### Example 2: TTS Factory with HTTP Fallback

```python
# providers/openai_tts_adapter.py
from .config import TTSConfig
from .http_tts import HttpTTS

def build_tts(config: TTSConfig):
    """Build TTS: OpenAI plugin if compatible, HttpTTS otherwise."""
    is_openai_compatible = (
        config.endpoint_path in ("", "/v1/audio/speech")
        and not config.response_field_map
        and config.text_field_name == "input"  # OpenAI uses "input" not "text"
    )

    if is_openai_compatible and config.base_url:
        from livekit.plugins.openai import TTS as OpenAITTS
        import openai, httpx

        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=15.0, read=30.0, write=5.0, pool=5.0),
            headers=config.custom_headers or {},
        )
        client = openai.AsyncClient(
            api_key=config.api_key or "no-key",
            base_url=config.base_url,
            max_retries=0,
            http_client=http_client,
        )
        return OpenAITTS(
            model=config.model or "tts-1",
            voice=config.voice or "alloy",
            speed=config.speed,
            client=client,
        )

    # Fallback to HTTP adapter for non-OpenAI servers
    return HttpTTS(
        base_url=config.base_url,
        synth_path=config.endpoint_path or "/tts",
        auth_header=config.custom_headers.get("Authorization"),
        engine=config.engine,
        language=config.language,
        text_field_name=config.text_field_name,
        body_params=config.custom_body_params or None,
    )
```

### Example 3: Parsing Metadata into Typed Config

```python
# providers/config.py — parsing from metadata.providers
def parse_llm_config(providers: dict) -> LLMConfig:
    """Parse LLM config from job metadata providers dict."""
    llm_cfg = providers.get("llm", {})
    return LLMConfig(
        base_url=llm_cfg.get("baseUrl", ""),
        api_key=llm_cfg.get("apiKey", ""),
        model=llm_cfg.get("model", ""),
        endpoint_path=llm_cfg.get("endpointPath", "/v1/chat/completions"),
        custom_headers=llm_cfg.get("customHeaders", {}),
        custom_body_params=llm_cfg.get("customBodyParams", {}),
        response_field_map=llm_cfg.get("responseFieldMap", {}),
    )
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 3) | Impact |
|------------------------|----------------------|--------|
| Ad-hoc `_build_*` functions with inline config parsing | Typed config models + factory functions | Cleaner, testable, extensible |
| `authHeader` as single string | Separate `api_key` + `custom_headers` dict | Supports any header override |
| Hard-coded fallback chain in `_build_llm` | Config-driven: if N8N configured use N8N, else OpenAI | Dashboard controls the behavior |
| No body param override for LLM | `extra_body` passed to OpenAI plugin | Temperature, top_p, etc from dashboard |
| Custom `HttpTTS`/`HttpSTT` as primary | OpenAI plugin as primary, HTTP adapters as fallback | More standard, less custom code for compatible servers |

## Metadata Config Shape (Post Phase 2)

The config flowing through `ctx.job.metadata.providers` after Phase 2 will look like:

```json
{
  "providers": {
    "stt": {
      "baseUrl": "https://stt.example.com",
      "apiKey": "sk-...",
      "model": "whisper-1",
      "endpointPath": "/v1/audio/transcriptions",
      "customHeaders": {"X-Custom": "value"},
      "customBodyParams": {"language": "tr"},
      "responseFieldMap": {}
    },
    "tts": {
      "baseUrl": "https://tts.example.com",
      "apiKey": "",
      "model": "tts-1",
      "endpointPath": "/tts",
      "customHeaders": {},
      "customBodyParams": {"speed": 1.2},
      "voice": "alloy",
      "engine": "f5-tts",
      "textFieldName": "text"
    },
    "llm": {
      "baseUrl": "https://llm.example.com/v1",
      "apiKey": "sk-...",
      "model": "llama3.1:8b",
      "endpointPath": "/v1/chat/completions",
      "customHeaders": {"X-Provider-Key": "abc"},
      "customBodyParams": {"temperature": 0.7}
    },
    "n8n": {
      "baseUrl": "https://n8n.example.com",
      "workflowId": "abc123",
      "webhookPath": "/webhook/abc123",
      "mcpWorkflowId": "def456"
    }
  }
}
```

**Important:** The exact field names depend on Phase 2 implementation. The adapter config parser must handle both the new schema (with `customHeaders`, `customBodyParams`, `endpointPath`) AND the existing legacy schema (with `authHeader`, `bodyParams`, `synthPath`, `transcribePath`) for backward compatibility during transition.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (for API) + pytest (for voice agent) |
| Config file | apps/voice-agent: none yet (needs pytest.ini or pyproject.toml [tool.pytest]) |
| Quick run command | `cd apps/voice-agent && python -m pytest tests/ -x --timeout=30` |
| Full suite command | `cd apps/voice-agent && python -m pytest tests/ -v` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADAPT-01 | Factory produces OpenAI plugin instances by default | unit | `python -m pytest tests/test_adapters.py::test_build_llm_returns_openai -x` | No - Wave 0 |
| ADAPT-02 | Custom headers applied to constructed client | unit | `python -m pytest tests/test_adapters.py::test_custom_headers_applied -x` | No - Wave 0 |
| ADAPT-03 | Custom body params passed as extra_body | unit | `python -m pytest tests/test_adapters.py::test_custom_body_params -x` | No - Wave 0 |
| ADAPT-04 | Custom endpoint path used (HttpTTS/HttpSTT) or base_url adjusted | unit | `python -m pytest tests/test_adapters.py::test_custom_endpoint_path -x` | No - Wave 0 |
| ADAPT-05 | Response field remapping works | unit | `python -m pytest tests/test_adapters.py::test_response_remap -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `cd apps/voice-agent && python -m pytest tests/ -x --timeout=30`
- **Per wave merge:** `cd apps/voice-agent && python -m pytest tests/ -v`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/voice-agent/tests/test_adapters.py` -- covers ADAPT-01 through ADAPT-05
- [ ] `apps/voice-agent/tests/conftest.py` -- shared fixtures (mock metadata, mock providers)
- [ ] `apps/voice-agent/pyproject.toml` [tool.pytest.ini_options] section -- pytest config
- [ ] Framework install: `pip install pytest pytest-asyncio` -- pytest not currently in dependencies

## Open Questions

1. **Phase 2 metadata field names**
   - What we know: Current metadata uses `baseUrl`, `synthPath`, `transcribePath`, `authHeader`, `bodyParams`
   - What's unclear: Phase 2 may introduce new field names like `customHeaders`, `endpointPath`, `apiKey`
   - Recommendation: Build the config parser to handle both old and new field names with a normalization step

2. **OpenAI TTS plugin endpoint path override**
   - What we know: The OpenAI SDK hardcodes `/v1/audio/speech` internally
   - What's unclear: Whether setting `base_url` to `https://server.com/custom` would result in `https://server.com/custom/audio/speech` (stripping `/v1` prefix)
   - Recommendation: Test this at implementation time. If it doesn't work, always use HttpTTS for non-standard paths.

3. **Backward compatibility during rollout**
   - What we know: Existing sessions use the old metadata shape
   - What's unclear: Will Phase 2 and Phase 3 deploy together or separately?
   - Recommendation: The adapter config parser should gracefully handle both old and new metadata shapes

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `apps/voice-agent/src/voice_agent/entrypoint.py` (1195 lines, all _build_* functions)
- Direct codebase analysis: `apps/voice-agent/src/voice_agent/providers/http_tts.py`, `http_stt.py`
- Direct codebase analysis: `apps/api/src/services/resolve-providers.ts` (metadata shape definition)
- Direct codebase analysis: `apps/api/src/routes/livekit.ts` (metadata injection at dispatch, lines 646-662)
- Installed package inspection: `livekit-plugins-openai` v1.4.4 source at `.venv/lib/python3.14/site-packages/livekit/plugins/openai/`
- Installed package inspection: `livekit-agents` v1.4.5 base classes (TTS, STT, LLM)

### Secondary (MEDIUM confidence)
- LiveKit Agents SDK patterns inferred from installed source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages already installed and in use
- Architecture: HIGH - Based on direct analysis of 1195-line entrypoint.py and all provider files
- Pitfalls: HIGH - Derived from understanding actual LiveKit plugin constructor APIs
- Adapter pattern: MEDIUM - The exact OpenAI SDK behavior with `base_url` path manipulation needs runtime verification

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable domain, existing codebase)
