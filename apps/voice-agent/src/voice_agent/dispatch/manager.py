from __future__ import annotations

import asyncio
import logging
from typing import Dict

from .models import DispatchStatus, DispatchTask, JoinTaskPayload

logger = logging.getLogger("coziyoo-voice-agent-dispatch")


class DispatchManager:
    def __init__(self, worker_count: int = 2) -> None:
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._tasks: Dict[str, DispatchTask] = {}
        self._workers: list[asyncio.Task[None]] = []
        self._worker_count = worker_count

    async def start(self) -> None:
        if self._workers:
            return
        for idx in range(self._worker_count):
            worker = asyncio.create_task(self._worker_loop(idx), name=f"dispatch-worker-{idx}")
            self._workers.append(worker)

    async def stop(self) -> None:
        for worker in self._workers:
            worker.cancel()
        await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def enqueue(self, payload: JoinTaskPayload) -> DispatchTask:
        task = DispatchTask(payload=payload)
        self._tasks[task.id] = task
        await self._queue.put(task.id)
        return task

    def get(self, task_id: str) -> DispatchTask | None:
        return self._tasks.get(task_id)

    async def _worker_loop(self, worker_idx: int) -> None:
        while True:
            task_id = await self._queue.get()
            task = self._tasks.get(task_id)
            if not task:
                self._queue.task_done()
                continue

            task.status = DispatchStatus.processing
            task.attempts += 1
            task.touch()

            try:
                await self._handle_task(task, worker_idx)
                task.status = DispatchStatus.completed
                task.error = None
            except Exception as exc:  # noqa: BLE001
                task.status = DispatchStatus.failed
                task.error = str(exc)
                logger.exception("dispatch task failed id=%s", task.id)
            finally:
                task.touch()
                self._queue.task_done()

    async def _handle_task(self, task: DispatchTask, worker_idx: int) -> None:
        # Placeholder orchestration stage:
        # queue + status transitions are now deterministic and observable.
        # Next stage will attach worker-level room join execution.
        logger.info(
            "worker=%s accepted room=%s identity=%s mode=%s",
            worker_idx,
            task.payload.roomName,
            task.payload.participantIdentity,
            task.payload.voiceMode,
        )
        await asyncio.sleep(0)
