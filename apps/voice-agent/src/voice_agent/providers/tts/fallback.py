from __future__ import annotations


class FallbackTTS:
    async def synthesize(self, text: str, language: str | None = None) -> bytes:
        _ = language
        # Placeholder byte payload for scaffold stage. Replace with streaming TTS engine.
        return text.encode("utf-8")
