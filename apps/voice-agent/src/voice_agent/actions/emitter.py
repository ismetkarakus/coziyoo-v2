from __future__ import annotations

import json

from livekit import api

from .schema import AgentActionEnvelope


async def emit_action(
    room_name: str,
    identity: str,
    api_key: str,
    api_secret: str,
    action: AgentActionEnvelope,
    livekit_url: str,
) -> None:
    encoded = json.dumps(action.model_dump(), separators=(",", ":")).encode("utf-8")

    lk_url = livekit_url
    if lk_url.startswith("wss://"):
        lk_url = f"https://{lk_url[len('wss://'):] }"
    elif lk_url.startswith("ws://"):
        lk_url = f"http://{lk_url[len('ws://'):] }"

    async with api.LiveKitAPI(url=lk_url, api_key=api_key, api_secret=api_secret) as lkapi:
        await lkapi.room.send_data(
            api.SendDataRequest(
                room=room_name,
                data=encoded,
                kind=api.DataPacketKind.RELIABLE,
                destination_identities=[identity],
                topic="agent-action",
            )
        )
