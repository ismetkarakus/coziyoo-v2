from __future__ import annotations

import asyncio
import datetime
import json
import logging
import os
import re
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import aiohttp
from livekit import rtc
from livekit.agents import (
    APIConnectionError,
    APIStatusError,
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    llm,
    room_io,
)
from livekit.agents.llm import LLM as BaseLLM
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.plugins import silero

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent")
llm_request_logger = logging.getLogger("coziyoo-voice-agent.requests.llm")
n8n_request_logger = logging.getLogger("coziyoo-voice-agent.requests.n8n")
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
        "coziyoo-voice-agent.requests.n8n",
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


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ("text", "content", "input_text", "transcript", "value"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw
        return ""
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            text = _coerce_text(item).strip()
            if text:
                parts.append(text)
        return " ".join(parts).strip()
    return ""


def _message_text(message: Any) -> str:
    if isinstance(message, dict):
        text = _coerce_text(message.get("content"))
        if text:
            return text
        return _coerce_text(message.get("text"))

    text_content = getattr(message, "text_content", None)
    if callable(text_content):
        try:
            text = str(text_content() or "").strip()
            if text:
                return text
        except Exception:
            pass

    for attr in ("content", "text", "input_text", "transcript", "value"):
        try:
            raw = getattr(message, attr, None)
        except Exception:
            raw = None
        text = _coerce_text(raw).strip()
        if text:
            return text
    return ""


def _chat_messages(chat_ctx: object) -> list[Any]:
    for attr in ("messages", "items", "history"):
        value = getattr(chat_ctx, attr, None)
        if callable(value):
            try:
                value = value()
            except Exception:
                value = None
        if isinstance(value, list):
            return value
    return []


def _last_user_preview(chat_ctx: object) -> str:
    messages = _chat_messages(chat_ctx)
    for message in reversed(messages):
        role = str(getattr(message, "role", message.get("role", "") if isinstance(message, dict) else "")).lower()
        if role != "user":
            continue
        text = _message_text(message)
        if text:
            return _compact_text(text)
    return ""


def _chat_history(chat_ctx: object, *, max_items: int = 24) -> list[dict[str, str]]:
    messages = _chat_messages(chat_ctx)
    out: list[dict[str, str]] = []
    for message in messages[-max_items:]:
        role = str(getattr(message, "role", message.get("role", "") if isinstance(message, dict) else "")).lower() or "user"
        text = _message_text(message)
        text = text.strip()
        if text:
            out.append({"role": role, "content": text})
    return out


def _fallback_user_text_from_stt() -> str:
    log_path = Path(
        os.getenv(
            "VOICE_AGENT_REQUEST_LOG_FILE",
            "/workspace/.runtime/voice-agent-requests.log",
        )
    )
    if not log_path.exists():
        return ""
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        return ""
    for line in reversed(lines[-300:]):
        try:
            item = json.loads(line)
        except Exception:
            continue
        if str(item.get("name") or "") != "coziyoo-voice-agent.requests.stt":
            continue
        message = str(item.get("message") or "")
        match = re.search(r"STT response text=(.*)$", message)
        if not match:
            continue
        text = match.group(1).strip()
        if text:
            return text
    return ""


def _extract_n8n_answer(body: Any) -> str:
    if isinstance(body, str):
        return body.strip()
    if not isinstance(body, dict):
        return ""

    for key in ("replyText", "answer", "text", "output", "message"):
        value = body.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    data = body.get("data")
    if isinstance(data, dict):
        for key in ("replyText", "answer", "text", "output", "message"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    return ""


def _deep_find_answer(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        direct = _extract_n8n_answer(value)
        if direct:
            return direct
        for child in value.values():
            found = _deep_find_answer(child)
            if found:
                return found
        return ""
    if isinstance(value, list):
        for child in value:
            found = _deep_find_answer(child)
            if found:
                return found
        return ""
    return ""


def _extract_execution_id(body: Any) -> str:
    if isinstance(body, dict):
        for key in ("id", "executionId"):
            value = body.get(key)
            if value is not None and str(value).strip():
                return str(value).strip()
        for key in ("data", "execution"):
            if key in body:
                found = _extract_execution_id(body.get(key))
                if found:
                    return found
    return ""


def _build_n8n_headers(n8n_cfg: dict) -> dict[str, str]:
    headers: dict[str, str] = {"Content-Type": "application/json"}
    auth_header = str(n8n_cfg.get("authHeader") or "").strip()
    if auth_header:
        headers["Authorization"] = auth_header
    api_key = (
        str(n8n_cfg.get("apiKey") or "").strip()
        or os.getenv("N8N_API_KEY", "").strip()
    )
    if api_key:
        headers["X-N8N-API-KEY"] = api_key
        headers["Authorization"] = headers.get("Authorization") or f"Bearer {api_key}"
    return headers


def _resolve_n8n_webhook(
    n8n_base_url: str,
    workflow_id: str,
    webhook_path: str = "",
    webhook_url: str = "",
) -> str:
    explicit = _normalize_base_url(webhook_url or os.getenv("N8N_LLM_WEBHOOK_URL", ""))
    if explicit:
        return explicit

    raw_path = (webhook_path or "").strip() or (os.getenv("N8N_LLM_WEBHOOK_PATH", "") or "").strip()
    parsed_path = urlparse(raw_path) if raw_path else None
    if parsed_path and parsed_path.scheme and parsed_path.netloc:
        return _normalize_base_url(raw_path)

    parsed_base = urlparse(n8n_base_url or "")
    base_has_webhook_path = bool(parsed_base.path and parsed_base.path not in ("", "/") and "webhook" in parsed_base.path.lower())

    # If baseUrl is already a full webhook URL, use it directly even when
    # webhook_path came from env/defaults.
    if base_has_webhook_path:
        if not raw_path:
            return _normalize_base_url(n8n_base_url)
        normalized_default = f"/webhook/{workflow_id}"
        if raw_path.strip() == normalized_default:
            return _normalize_base_url(n8n_base_url)

    if not raw_path:
        if parsed_base.path and parsed_base.path not in ("", "/"):
            # Support saving a full webhook URL directly in DB n8n.baseUrl
            return _normalize_base_url(n8n_base_url)
        raw_path = f"/webhook/{workflow_id}"

    path = raw_path
    if not n8n_base_url:
        return ""
    return f"{n8n_base_url.rstrip('/')}/{path.lstrip('/')}"


class N8nLLM(BaseLLM):
    def __init__(
        self,
        *,
        endpoint: str,
        headers: dict[str, str],
        workflow_id: str,
        base_url: str,
        runtime_ctx: dict[str, str],
    ) -> None:
        super().__init__()
        self._endpoint = endpoint
        self._headers = headers
        self._workflow_id = workflow_id
        self._base_url = base_url.rstrip("/")
        self._runtime_ctx = runtime_ctx
        self._session: aiohttp.ClientSession | None = None

    @property
    def model(self) -> str:
        return f"n8n:{self._workflow_id}"

    @property
    def provider(self) -> str:
        return "n8n"

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def chat(
        self,
        *,
        chat_ctx: Any,
        tools: list[Any] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        **_kwargs: Any,
    ):
        return N8nLLMStream(
            self,
            chat_ctx=chat_ctx,
            tools=tools or [],
            conn_options=conn_options,
            endpoint=self._endpoint,
            base_url=self._base_url,
            headers=self._headers,
            workflow_id=self._workflow_id,
            runtime_ctx=self._runtime_ctx,
        )

    async def aclose(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()


class N8nLLMStream(llm.LLMStream):
    def __init__(
        self,
        llm_v: N8nLLM,
        *,
        chat_ctx: Any,
        tools: list[Any],
        conn_options: APIConnectOptions,
        endpoint: str,
        base_url: str,
        headers: dict[str, str],
        workflow_id: str,
        runtime_ctx: dict[str, str],
    ) -> None:
        super().__init__(llm_v, chat_ctx=chat_ctx, tools=tools, conn_options=conn_options)
        self._endpoint = endpoint
        self._base_url = base_url
        self._headers = headers
        self._workflow_id = workflow_id
        self._runtime_ctx = runtime_ctx

    async def _run(self) -> None:
        user_text = _last_user_preview(self._chat_ctx)
        messages = _chat_history(self._chat_ctx)
        if not user_text:
            fallback_text = _fallback_user_text_from_stt()
            if fallback_text:
                user_text = fallback_text
                if not messages:
                    messages = [{"role": "user", "content": fallback_text}]
        payload = {
            "workflowId": self._workflow_id,
            "source": "voice-agent",
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "roomId": self._runtime_ctx.get("roomId"),
            "jobId": self._runtime_ctx.get("jobId"),
            "deviceId": self._runtime_ctx.get("deviceId"),
            "userText": user_text,
            "messages": messages,
            "mcpWorkflowId": self._runtime_ctx.get("mcpWorkflowId"),
        }
        request_id = f"n8n-{uuid.uuid4().hex[:12]}"
        session = self._llm._get_session()  # type: ignore[attr-defined]
        n8n_request_logger.info(
            "N8N request endpoint=%s workflow=%s text=%s",
            self._endpoint,
            self._workflow_id,
            user_text,
        )

        webhook_error: Exception | None = None
        try:
            answer = await self._run_webhook(session=session, payload=payload)
            n8n_request_logger.info("N8N response path=webhook status=200 answer=%s", answer)
            self._event_ch.send_nowait(
                llm.ChatChunk(
                    id=request_id,
                    delta=llm.ChoiceDelta(role="assistant", content=answer, extra={"path": "webhook"}),
                )
            )
            return
        except Exception as exc:
            webhook_error = exc
            n8n_request_logger.warning("N8N response path=webhook error=%s", exc)

        try:
            answer = await self._run_execution_api(session=session, payload=payload)
            n8n_request_logger.info("N8N response path=execution_api status=200 answer=%s", answer)
            self._event_ch.send_nowait(
                llm.ChatChunk(
                    id=request_id,
                    delta=llm.ChoiceDelta(role="assistant", content=answer, extra={"path": "execution_api"}),
                )
            )
            return
        except Exception as exec_error:
            n8n_request_logger.error("N8N response path=execution_api error=%s", exec_error)
            if isinstance(exec_error, APIStatusError):
                raise exec_error
            if isinstance(exec_error, APIConnectionError):
                raise exec_error
            if webhook_error:
                raise APIConnectionError(
                    f"n8n webhook+execution fallback failed: {webhook_error}; {exec_error}",
                    retryable=True,
                ) from exec_error
            raise APIConnectionError(f"n8n execution fallback failed: {exec_error}", retryable=True) from exec_error

    async def _run_webhook(self, *, session: aiohttp.ClientSession, payload: dict[str, Any]) -> str:
        async with session.post(
            self._endpoint,
            json=payload,
            headers=self._headers,
            timeout=aiohttp.ClientTimeout(total=self._conn_options.timeout),
        ) as resp:
            raw = await resp.text()
            parsed: Any
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw

            if resp.status >= 400:
                raise APIStatusError(
                    f"n8n webhook error {resp.status}: {raw[:200]}",
                    status_code=resp.status,
                    body=raw[:500],
                    retryable=resp.status >= 500 or resp.status == 429,
                )

            answer = _extract_n8n_answer(parsed)
            if not answer:
                answer = _deep_find_answer(parsed)
            if not answer:
                raise APIConnectionError("n8n webhook returned empty answer", retryable=False)
            return answer

    async def _run_execution_api(self, *, session: aiohttp.ClientSession, payload: dict[str, Any]) -> str:
        create_url = f"{self._base_url}/api/v1/executions"
        create_payload = {
            "workflowId": self._workflow_id,
            "data": payload,
        }
        async with session.post(
            create_url,
            json=create_payload,
            headers=self._headers,
            timeout=aiohttp.ClientTimeout(total=self._conn_options.timeout),
        ) as resp:
            raw = await resp.text()
            parsed: Any
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw
            if resp.status >= 400:
                raise APIStatusError(
                    f"n8n execution create error {resp.status}: {raw[:200]}",
                    status_code=resp.status,
                    body=raw[:500],
                    retryable=resp.status >= 500 or resp.status == 429,
                )
            execution_id = _extract_execution_id(parsed)
            if not execution_id:
                raise APIConnectionError("n8n execution create response missing execution id", retryable=False)

        await asyncio.sleep(0.6)
        fetch_url = f"{self._base_url}/api/v1/executions/{execution_id}?includeData=true"
        async with session.get(
            fetch_url,
            headers=self._headers,
            timeout=aiohttp.ClientTimeout(total=self._conn_options.timeout),
        ) as resp:
            raw = await resp.text()
            parsed: Any
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw
            if resp.status >= 400:
                raise APIStatusError(
                    f"n8n execution read error {resp.status}: {raw[:200]}",
                    status_code=resp.status,
                    body=raw[:500],
                    retryable=resp.status >= 500 or resp.status == 429,
                )
            answer = _deep_find_answer(parsed)
            if not answer:
                raise APIConnectionError("n8n execution result missing answer text", retryable=False)
            return answer


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
        llm_request_logger.info(
            "LLM request text=%s",
            sent_text,
        )
        inner_stream = self._inner.chat(**kwargs)
        return LoggingLLMStream(
            inner=inner_stream,
            provider=self.provider,
            model=self.model,
            logger=llm_request_logger,
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
        self._path = "unknown"
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
        extra = getattr(delta, "extra", None)
        if isinstance(extra, dict):
            path_value = extra.get("path")
            if isinstance(path_value, str) and path_value.strip():
                self._path = path_value.strip()
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
            "LLM response path=%s model=%s answer=%s",
            self._path,
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


def _build_llm(providers: dict, runtime_ctx: dict[str, str] | None = None):
    """Build an LLM instance from provider config."""
    runtime_ctx = runtime_ctx or {}
    llm_cfg = providers.get("llm", {})
    n8n_cfg_raw = providers.get("n8n", {})
    n8n_cfg = n8n_cfg_raw if isinstance(n8n_cfg_raw, dict) else {}
    workflow_id = str(
        n8n_cfg.get("workflowId")
        or os.getenv("N8N_LLM_WORKFLOW_ID", "")
        or "6KFFgjd26nF0kNCA"
    ).strip()
    n8n_base_url = _normalize_base_url(
        str(n8n_cfg.get("baseUrl") or os.getenv("N8N_HOST", ""))
    )
    n8n_endpoint = _resolve_n8n_webhook(
        n8n_base_url,
        workflow_id,
        webhook_path=str(n8n_cfg.get("webhookPath") or ""),
        webhook_url=str(n8n_cfg.get("webhookUrl") or ""),
    )
    if n8n_endpoint:
        logger.info("Using N8N LLM webhook: %s workflow=%s", n8n_endpoint, workflow_id)
        n8n_llm = N8nLLM(
            endpoint=n8n_endpoint,
            headers=_build_n8n_headers(n8n_cfg),
            workflow_id=workflow_id,
            base_url=n8n_base_url,
            runtime_ctx={
                "roomId": str(runtime_ctx.get("roomId", "") or ""),
                "jobId": str(runtime_ctx.get("jobId", "") or ""),
                "deviceId": str(runtime_ctx.get("deviceId", "") or ""),
                "mcpWorkflowId": str(n8n_cfg.get("mcpWorkflowId") or os.getenv("N8N_MCP_WORKFLOW_ID", "XYiIkxpa4PlnddQt")),
            },
        )
        return n8n_llm

    logger.warning("N8N LLM not configured; falling back to OpenAI-compatible LLM provider")
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
    llm_instance = _build_llm(
        providers,
        runtime_ctx={
            "roomId": str(ctx.room.name),
            "jobId": str(getattr(ctx.job, "id", "") or ""),
            "deviceId": str(metadata_data.get("deviceId", "") or ""),
        },
    )
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
