from __future__ import annotations

import aiohttp


async def send_session_end(
    api_base_url: str,
    shared_secret: str,
    room_name: str,
    summary: str,
    device_id: str | None = None,
) -> None:
    payload = {
        "roomName": room_name,
        "summary": summary,
        "outcome": "completed",
        "deviceId": device_id,
    }

    headers = {
        "content-type": "application/json",
        "x-ai-server-secret": shared_secret,
    }

    timeout = aiohttp.ClientTimeout(total=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.post(f"{api_base_url.rstrip('/')}/v1/livekit/session/end", json=payload, headers=headers) as response:
            if response.status >= 400:
                body = await response.text()
                raise RuntimeError(f"session_end_failed_{response.status}:{body}")
