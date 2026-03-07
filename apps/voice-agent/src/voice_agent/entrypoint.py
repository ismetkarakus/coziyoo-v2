from __future__ import annotations

import json
import logging
import os
from urllib.parse import urlparse

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli, room_io
from livekit.plugins import noise_cancellation, silero

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent")
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


def _audio_input_options() -> room_io.AudioInputOptions:
    # LiveKit BVC/BVCTelephony filters require LiveKit Cloud features.
    # Keep this off by default for self-hosted deployments to avoid noisy errors.
    enable_noise_filter = _env_bool("LIVEKIT_ENABLE_NOISE_CANCELLATION", False)
    if not enable_noise_filter:
        return room_io.AudioInputOptions()

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
        return LLM(
            model=model,
            base_url=openai_base,
            api_key=api_key,
        )
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

    logger.info(
        "Starting session deviceId=%s language=%s stt=%s llm=%s tts=%s",
        metadata_data.get("deviceId", "?"),
        language,
        providers.get("stt", {}).get("baseUrl", "?"),
        providers.get("llm", {}).get("baseUrl", "?"),
        providers.get("tts", {}).get("baseUrl", "?"),
    )

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


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    cli.run_app(server)


if __name__ == "__main__":
    main()
