import json
import logging
from starlette.websockets import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self._connections[user_id] = websocket
        logger.info(f"WS connected: {user_id} (total: {len(self._connections)})")

    def disconnect(self, user_id: str):
        self._connections.pop(user_id, None)
        logger.info(f"WS disconnected: {user_id} (total: {len(self._connections)})")

    async def send_to(self, user_id: str, message: dict):
        ws = self._connections.get(user_id)
        if ws:
            await ws.send_text(json.dumps(message))

    async def broadcast(self, message: dict, exclude: str | None = None):
        payload = json.dumps(message)
        for uid, ws in list(self._connections.items()):
            if uid == exclude:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                self.disconnect(uid)

    @property
    def connected_user_ids(self) -> list[str]:
        return list(self._connections.keys())


ws_manager = ConnectionManager()
