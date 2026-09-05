import asyncio
import json
import logging
from collections import defaultdict
from datetime import datetime
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


def _encode(obj: Any) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"Not JSON serialisable: {type(obj)}")


class ConnectionManager:
    """Fan-out hub. One channel per league so two auctions never cross wires."""

    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    def is_full(self, league_id: int, limit: int) -> bool:
        """Is the room at capacity?

        Counted per league. The organiser is admitted regardless — being shut
        out of your own auction because thirty people are watching would be
        absurd.
        """
        return len(self._rooms.get(league_id, ())) >= limit

    async def connect(self, league_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._rooms[league_id].add(ws)
        log.info("ws connected league=%s viewers=%s", league_id, len(self._rooms[league_id]))

    async def disconnect(self, league_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._rooms[league_id].discard(ws)

    def viewer_count(self, league_id: int) -> int:
        return len(self._rooms.get(league_id, ()))

    async def broadcast(self, league_id: int, event: str, payload: Any) -> None:
        message = json.dumps({"event": event, "payload": payload}, default=_encode)
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(league_id, ())):
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._rooms[league_id].discard(ws)


manager = ConnectionManager()
