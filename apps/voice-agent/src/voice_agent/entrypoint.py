from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli, room_io
from livekit.agents.llm import LLM as BaseLLM
from livekit.plugins import silero

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent")
request_logger = logging.getLogger("coziyoo-voice-agent.requests.llm")
settings = get_settings()


class VoiceSalesAgent(Agent):
    def __init__(self, metadata: str) -> None:
        self._metadata = metadata
        try:
            meta = json.loads(metadata)
        except (json.JSONDecodeError, TypeError):
            meta = {}

        system_prompt = meta.get("systemPrompt") or (
            "You are a voice-first sales assistant. Keep responses concise for speech output. "
            "Only produce allowlisted UI actions through tools or structured action channel. "
            "Do not invent unsupported actions."
        )

        super().__init__(instructions=system_prompt)

    async def on_enter(self) -> None:
        try:
            meta = json.loads(self._metadata)
        except (json.JSONDecodeError, TypeError):
            meta = {}

        greeting_enabled = meta.get("greetingEnabled", True)
        if not greeting_enabled:
            return

        greeting = meta.get("greetingInstruction") or (
            "Greet the user briefly and ask their sales goal in one sentence."
        )

        await self.session.generate_reply(
            instructions=greeting,
            allow_interruptions=True,
        )


server = AgentServer(shutdown_process_timeout=60.0)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _configure_logging() -> None:
    """Configure root and library logger levels from environment."""
    level_name = (
        os.getenv("VOICE_AGENT_LOG_LEVEL")
        or os.getenv("LOG_LEVEL")
        or "INFO"
    ).strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level)
    request_level_name = (os.getenv("VOICE_AGENT_REQUEST_LOG_LEVEL") or "INFO").strip().upper()
    request_level = getattr(logging, request_level_name, logging.INFO)

    # Keep third-party logs aligned with requested verbosity.
    for logger_name in (
        "livekit",
        "livekit.agents",
        "openai",
        "httpx",
        "httpcore",
        "urllib3",
        "coziyoo-voice-agent",
        "coziyoo-voice-agent.http-stt",
        "coziyoo-voice-agent.http-tts",
        "coziyoo-voice-agent-join",
    ):
        logging.getLogger(logger_name).setLevel(level)

    request_log_file = Path(
        os.getenv(
            "VOICE_AGENT_REQUEST_LOG_FILE",
            "/workspace/.runtime/voice-agent-requests.log",
        )
    )
    request_log_file.parent.mkdir(parents=True, exist_ok=True)
    request_log_max_bytes = int(os.getenv("VOICE_AGENT_REQUEST_LOG_MAX_BYTES", "5242880"))
    request_log_backup_count = int(os.getenv("VOICE_AGENT_REQUEST_LOG_BACKUP_COUNT", "3"))
    request_handler = RotatingFileHandler(
        request_log_file,
        maxBytes=request_log_max_bytes,
        backupCount=request_log_backup_count,
        encoding="utf-8",
    )
    request_handler.setLevel(request_level)
    request_handler.setFormatter(_JsonLineFormatter())

    for logger_name in (
        "coziyoo-voice-agent.requests.llm",
        "coziyoo-voice-agent.requests.stt",
        "coziyoo-voice-agent.requests.tts",
    ):
        request_log = logging.getLogger(logger_name)
        request_log.setLevel(request_level)
        request_log.handlers.clear()
        request_log.propagate = False
        request_log.addHandler(request_handler)


class _JsonLineFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "level": record.levelname,
            "name": record.name,
            "message": record.getMessage(),
        }
        job_id = getattr(record, "job_id", None)
        room_id = getattr(record, "room_id", None)
        if job_id:
            payload["job_id"] = str(job_id)
        if room_id:
            payload["room_id"] = str(room_id)
        return json.dumps(payload, ensure_ascii=True)


def _compact_text(value: str, max_len: int = 160) -> str:
    text = " ".join((value or "").split())
    if len(text) <= max_len:
        return text
    return f"{text[:max_len]}..."


def _last_user_preview(chat_ctx: object) -> str:
    messages_attr = getattr(chat_ctx, "messages", None)
    messages = messages_attr() if callable(messages_attr) else (messages_attr or [])
    for message in reversed(messages):
        role = str(getattr(message, "role", "")).lower()
        if role != "user":
            continue
        text = ""
        text_content = getattr(message, "text_content", None)
        if callable(text_content):
            try:
                text = str(text_content() or "")
            except Exception:
                text = ""
        if not text:
            content = getattr(message, "content", None)
            if isinstance(content, str):
                text = content
        if text:
            return _compact_text(text)
    return ""


class LoggingLLM(BaseLLM):
    """Small wrapper to emit request traces before delegating to real LLM."""

    def __init__(self, inner: BaseLLM, model: str, base_url: str) -> None:
        super().__init__()
        self._inner = inner
        self._model = model
        self._base_url = base_url

    @property
    def model(self) -> str:
        return str(getattr(self._inner, "model", self._model))

    @property
    def provider(self) -> str:
        return str(getattr(self._inner, "provider", "openai-compatible-llm"))

    def chat(self, **kwargs):
        chat_ctx = kwargs.get("chat_ctx")
        sent_text = _last_user_preview(chat_ctx)
        request_logger.info(
            "LLM request text=%s",
            sent_text,
        )
        inner_stream = self._inner.chat(**kwargs)
        return LoggingLLMStream(
            inner=inner_stream,
            provider=self.provider,
            model=self.model,
            logger=request_logger,
        )

    def prewarm(self) -> None:
        self._inner.prewarm()

    async def aclose(self) -> None:
        await self._inner.aclose()


class LoggingLLMStream:
    def __init__(self, *, inner: Any, provider: str, model: str, logger: logging.Logger) -> None:
        self._inner = inner
        self._provider = provider
        self._model = model
        self._logger = logger
        self._parts: list[str] = []
        self._logged_summary = False

    async def __aenter__(self):
        await self._inner.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        try:
            return await self._inner.__aexit__(exc_type, exc, tb)
        finally:
            self._emit_summary()

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            chunk = await self._inner.__anext__()
        except StopAsyncIteration:
            self._emit_summary()
            raise
        delta = getattr(chunk, "delta", None)
        content = getattr(delta, "content", None)
        if isinstance(content, str) and content:
            self._parts.append(content)
        return chunk

    async def aclose(self) -> None:
        try:
            await self._inner.aclose()
        finally:
            self._emit_summary()

    def __getattr__(self, name: str):
        return getattr(self._inner, name)

    def _emit_summary(self) -> None:
        if self._logged_summary:
            return
        self._logged_summary = True
        text = "".join(self._parts).strip()
        self._logger.info(
            "LLM response model=%s answer=%s",
            self._model,
            text,
        )


def _audio_input_options() -> room_io.AudioInputOptions:
    # LiveKit BVC/BVCTelephony filters require LiveKit Cloud features.
    # Keep this off by default for self-hosted deployments to avoid noisy errors.
    enable_noise_filter = _env_bool("LIVEKIT_ENABLE_NOISE_CANCELLATION", False)
    if not enable_noise_filter:
        return room_io.AudioInputOptions()

    # Guard against enabling cloud-only filters on self-hosted LiveKit.
    parsed = urlparse(settings.livekit_url)
    host = (parsed.hostname or "").lower()
    if "livekit.cloud" not in host:
        logger.warning(
            "LIVEKIT_ENABLE_NOISE_CANCELLATION is enabled but LIVEKIT_URL=%s is not LiveKit Cloud; disabling filter",
            settings.LIVEKIT_URL,
        )
        return room_io.AudioInputOptions()

    # Import only when explicitly enabled to avoid loading cloud-only noise
    # filtering paths on self-hosted deployments.
    from livekit.plugins import noise_cancellation

    return room_io.AudioInputOptions(
        noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
        if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
        else noise_cancellation.BVC(),
    )


def _normalize_base_url(value: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return ""
    parsed = urlparse(candidate)
    if parsed.scheme and parsed.netloc:
        return candidate
    if parsed.scheme and not parsed.netloc:
        # Handle malformed values like "https:ollama.example.com"
        tail = candidate[len(parsed.scheme) + 1 :].lstrip("/")
        return f"{parsed.scheme}://{tail}"
    return f"http://{candidate}"


def _build_stt(providers: dict, language: str):
    """Build an STT instance from provider config."""
    stt_cfg = providers.get("stt", {})
    base_url = _normalize_base_url(str(stt_cfg.get("baseUrl") or ""))

    if base_url:
        from .providers.http_stt import HttpSTT

        logger.info("Using HTTP STT: %s", base_url)
        return HttpSTT(
            base_url=base_url,
            transcribe_path=stt_cfg.get("transcribePath", "/v1/audio/transcriptions"),
            model=stt_cfg.get("model", "whisper-1"),
            language=language,
            response_format=stt_cfg.get("responseFormat", "verbose_json"),
            auth_header=stt_cfg.get("authHeader"),
            query_params=stt_cfg.get("queryParams") or None,
        )

    # Fallback: try livekit-plugins-openai with env-configured Whisper
    try:
        from livekit.plugins.openai import stt as openai_stt

        whisper_base = _normalize_base_url(os.getenv("SPEECH_TO_TEXT_BASE_URL", ""))
        if whisper_base:
            logger.info("Using OpenAI-compatible STT plugin: %s", whisper_base)
            return openai_stt.STT(
                model="whisper-1",
                base_url=whisper_base,
                api_key=os.getenv("SPEECH_TO_TEXT_API_KEY", "no-key"),
                language=language,
            )
    except ImportError:
        pass

    raise RuntimeError(
        "No STT provider configured. Set stt.baseUrl in admin agent settings "
        "or install livekit-plugins-openai and set SPEECH_TO_TEXT_BASE_URL."
    )


def _build_llm(providers: dict):
    """Build an LLM instance from provider config."""
    llm_cfg = providers.get("llm", {})
    model = llm_cfg.get("model", os.getenv("OLLAMA_CHAT_MODEL", "llama3.1:8b"))
    base_url = _normalize_base_url(str(llm_cfg.get("baseUrl") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")))
    auth_header = llm_cfg.get("authHeader") or None

    # Extract API key from auth header (strip "Bearer " prefix if present)
    api_key = "ollama"
    if auth_header:
        api_key = auth_header.removeprefix("Bearer ").strip() or "ollama"

    if not base_url:
        raise RuntimeError(
            "No LLM base URL configured. Set llm.baseUrl in admin agent settings "
            "or set OLLAMA_BASE_URL."
        )

    # Ollama exposes an OpenAI-compatible API at /v1
    openai_base = f"{base_url.rstrip('/')}/v1"

    try:
        from livekit.plugins.openai import LLM

        logger.info("Using OpenAI-compatible LLM (Ollama): %s model=%s", openai_base, model)
        llm = LLM(
            model=model,
            base_url=openai_base,
            api_key=api_key,
        )
        return LoggingLLM(inner=llm, model=str(model), base_url=openai_base)
    except ImportError:
        raise RuntimeError(
            "livekit-plugins-openai is required for LLM support. "
            "Install it: pip install livekit-plugins-openai"
        )


def _build_tts(providers: dict, language: str):
    """Build a TTS instance from provider config."""
    tts_cfg = providers.get("tts", {})
    base_url = _normalize_base_url(str(tts_cfg.get("baseUrl") or ""))
    engine = tts_cfg.get("engine", "f5-tts")

    if base_url:
        from .providers.http_tts import HttpTTS

        logger.info("Using HTTP TTS (%s): %s", engine, base_url)
        return HttpTTS(
            base_url=base_url,
            synth_path=tts_cfg.get("synthPath", "/tts"),
            auth_header=tts_cfg.get("authHeader"),
            engine=engine,
            language=language,
            text_field_name=tts_cfg.get("textFieldName", "text"),
            body_params=tts_cfg.get("bodyParams") or None,
            query_params=tts_cfg.get("queryParams") or None,
        )

    # Fallback: try OpenAI TTS plugin with env TTS_BASE_URL
    tts_env_url = _normalize_base_url(os.getenv("TTS_BASE_URL", ""))
    if tts_env_url:
        from .providers.http_tts import HttpTTS

        logger.info("Using HTTP TTS from env TTS_BASE_URL: %s", tts_env_url)
        return HttpTTS(
            base_url=tts_env_url,
            engine=engine,
            language=language,
        )

    raise RuntimeError(
        "No TTS provider configured. Set tts.baseUrl in admin agent settings "
        "or set TTS_BASE_URL environment variable."
    )


async def _notify_session_end(
    room_name: str,
    started_at: str,
    ended_at: str,
    metadata_data: dict,
    api_base_url: str,
    shared_secret: str,
) -> None:
    """Report session completion to the API, which forwards the event to N8N."""
    if not api_base_url or not shared_secret:
        logger.warning(
            "Session end not reported: API_BASE_URL or AI_SERVER_SHARED_SECRET not configured"
        )
        return

    url = f"{api_base_url.rstrip('/')}/v1/livekit/session/end"
    payload: dict = {
        "roomName": room_name,
        "summary": "Voice session completed.",
        "startedAt": started_at,
        "endedAt": ended_at,
        "outcome": "completed",
    }
    device_id = metadata_data.get("deviceId")
    if device_id:
        payload["deviceId"] = device_id

    try:
        async with aiohttp.ClientSession() as http:
            async with http.post(
                url,
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-ai-server-secret": shared_secret,
                },
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                body = await resp.text()
                if resp.status >= 400:
                    logger.warning(
                        "Session end API call failed status=%s body=%s",
                        resp.status,
                        body[:200],
                    )
                else:
                    logger.info("Session end reported to API status=%s", resp.status)
    except Exception as exc:
        logger.warning("Failed to report session end to API: %s", exc)


@server.rtc_session(agent_name="coziyoo-voice-agent")
async def entrypoint(ctx: JobContext) -> None:
    metadata = ctx.job.metadata or "{}"
    try:
        metadata_data = json.loads(metadata)
    except json.JSONDecodeError:
        metadata_data = {}

    language = "en"
    providers = {}

    if isinstance(metadata_data, dict):
        language = str(metadata_data.get("voiceLanguage") or metadata_data.get("locale") or "en").split("-")[0]
        providers = metadata_data.get("providers", {})

    started_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

    logger.info(
        "Starting session deviceId=%s language=%s stt=%s llm=%s tts=%s",
        metadata_data.get("deviceId", "?"),
        language,
        providers.get("stt", {}).get("baseUrl", "?"),
        providers.get("llm", {}).get("baseUrl", "?"),
        providers.get("tts", {}).get("baseUrl", "?"),
    )

    # Track room disconnect so we can report session end regardless of how start() behaves
    disconnect_fut: asyncio.Future[None] = asyncio.get_event_loop().create_future()

    def _on_disconnected(*_args: object) -> None:
        if not disconnect_fut.done():
            disconnect_fut.set_result(None)

    ctx.room.on("disconnected", _on_disconnected)

    stt_instance = _build_stt(providers, language)
    llm_instance = _build_llm(providers)
    tts_instance = _build_tts(providers, language)

    session = AgentSession(
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    await session.start(
        agent=VoiceSalesAgent(metadata=metadata),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=_audio_input_options(),
        ),
    )

    # If session.start() is non-blocking, wait for the actual room disconnect
    if not disconnect_fut.done():
        await disconnect_fut

    ended_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    await _notify_session_end(
        room_name=ctx.room.name,
        started_at=started_at,
        ended_at=ended_at,
        metadata_data=metadata_data,
        api_base_url=settings.api_base_url,
        shared_secret=settings.ai_server_shared_secret,
    )


def main() -> None:
    _configure_logging()
    cli.run_app(server)


if __name__ == "__main__":
    main()
