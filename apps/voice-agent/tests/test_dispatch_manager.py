import asyncio

from voice_agent.dispatch.manager import DispatchManager
from voice_agent.dispatch.models import DispatchStatus, JoinTaskPayload


async def _run_once() -> None:
    manager = DispatchManager(worker_count=1)
    await manager.start()

    task = await manager.enqueue(
        JoinTaskPayload(
            roomName="room-a",
            participantIdentity="agent-room-a",
            participantName="agent",
            wsUrl="wss://livekit.example.com",
            token="token",
            metadata="{}",
        )
    )

    for _ in range(20):
        current = manager.get(task.id)
        if current and current.status in (DispatchStatus.completed, DispatchStatus.failed):
            break
        await asyncio.sleep(0.01)

    current = manager.get(task.id)
    assert current is not None
    assert current.status == DispatchStatus.completed

    await manager.stop()


def test_dispatch_manager_queue_flow() -> None:
    asyncio.run(_run_once())
