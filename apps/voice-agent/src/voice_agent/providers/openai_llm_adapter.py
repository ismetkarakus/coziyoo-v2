from __future__ import annotations

from livekit.plugins.openai import LLM as OpenAILLM

from .config import LLMConfig


def build_llm(config: LLMConfig):
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
