from __future__ import annotations

import asyncio
import json
import logging

from livekit import rtc
from livekit.agents import Agent, AgentServer, AgentSession, JobContext, JobProcess, cli, inference, room_io
from livekit.plugins import noise_cancellation, silero

from .config.settings import get_settings

logger = logging.getLogger("coziyoo-voice-agent")
settings = get_settings()


class VoiceSalesAgent(Agent):
    def __init__(self, metadata: str) -> None:
        self._metadata = metadata
        super().__init__(
            instructions=(
                "You are a voice-first sales assistant. Keep responses concise for speech output. "
                "Only produce allowlisted UI actions through tools or structured action channel. "
                "Do not invent unsupported actions."
            )
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions="Greet the user briefly and ask their sales goal in one sentence.",
            allow_interruptions=True,
        )


server = AgentServer(shutdown_process_timeout=60.0)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="coziyoo-voice-agent")
async def entrypoint(ctx: JobContext) -> None:
    metadata = ctx.job.metadata or "{}"
    try:
        metadata_data = json.loads(metadata)
    except json.JSONDecodeError:
        metadata_data = {}

    language = "en"
    if isinstance(metadata_data, dict):
        language = str(metadata_data.get("locale") or "en").split("-")[0]

    session = AgentSession(
        stt=inference.STT(model="cartesia/ink-whisper", language=language),
        llm=inference.LLM(model="openai/gpt-4.1-mini"),
        tts=inference.TTS(model="inworld/inworld-tts-1.5-mini", voice="Ashley", language=language),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    await session.start(
        agent=VoiceSalesAgent(metadata=metadata),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda params: noise_cancellation.BVCTelephony()
                if params.participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                else noise_cancellation.BVC(),
            ),
        ),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    cli.run_app(server)


if __name__ == "__main__":
    main()
