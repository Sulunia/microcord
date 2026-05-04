import json
import logging
import secrets

from starlette.websockets import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Registry of active WebSocket connections, keyed by user ID.

    Supports multiple simultaneous connections per user (e.g. multiple
    browser tabs).  Each connection is assigned a unique ``connection_id``
    on connect.

    Storage layout::

        _connections[user_id][connection_id] = WebSocket
    """

    def __init__(self) -> None:
        self._connections: dict[str, dict[str, WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> str:
        """Accept a WebSocket and register it under the given user.

        Returns a unique ``connection_id`` for this specific connection.
        """
        await websocket.accept()
        connection_id = secrets.token_urlsafe(16)
        if user_id not in self._connections:
            self._connections[user_id] = {}
        self._connections[user_id][connection_id] = websocket
        logger.info(
            "WS connected: user=%s conn=%s (users=%d, connections=%d)",
            user_id,
            connection_id,
            len(self._connections),
            self.total_connections,
        )
        return connection_id

    def disconnect(self, user_id: str, connection_id: str) -> bool:
        """Remove a specific connection.

        Returns ``True`` if this was the **last** connection for the user
        (i.e. the user is now fully offline).
        """
        user_conns = self._connections.get(user_id)
        if user_conns is None:
            return True
        user_conns.pop(connection_id, None)
        is_last = len(user_conns) == 0
        if is_last:
            del self._connections[user_id]
        logger.info(
            "WS disconnected: user=%s conn=%s last=%s (users=%d, connections=%d)",
            user_id,
            connection_id,
            is_last,
            len(self._connections),
            self.total_connections,
        )
        return is_last

    async def send_to(self, user_id: str, message: dict) -> None:
        """Send a message to **all** active connections of a user."""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return
        payload = json.dumps(message)
        stale_connection_ids: list[str] = []
        for conn_id, ws in list(user_conns.items()):
            try:
                await ws.send_text(payload)
            except Exception:
                logger.exception("Failed to send to user=%s conn=%s", user_id, conn_id)
                stale_connection_ids.append(conn_id)
        for stale_conn_id in stale_connection_ids:
            user_conns.pop(stale_conn_id, None)
        if not user_conns:
            del self._connections[user_id]

    async def send_to_connection(
        self, user_id: str, connection_id: str, message: dict
    ) -> None:
        """Send a message to a single specific connection of a user."""
        user_conns = self._connections.get(user_id)
        if not user_conns:
            return
        ws = user_conns.get(connection_id)
        if not ws:
            return
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            logger.exception(
                "Failed to send to user=%s conn=%s, removing", user_id, connection_id
            )
            user_conns.pop(connection_id, None)
            if not user_conns:
                del self._connections[user_id]

    async def broadcast(
        self,
        message: dict,
        exclude_user: str | None = None,
        exclude_connection: tuple[str, str] | None = None,
    ) -> None:
        """Fan-out to all connections of all users.

        Args:
            exclude_user: If set, exclude **all** connections of this user.
            exclude_connection: If set, a ``(user_id, connection_id)`` tuple
                that excludes only that specific connection (the user's other
                connections still receive the message).  Ignored when
                *exclude_user* is also set (user-level exclusion wins).
        """
        payload = json.dumps(message)
        stale_pairs: list[tuple[str, str]] = []
        for user_id, user_conns in list(self._connections.items()):
            if user_id == exclude_user:
                continue
            for conn_id, ws in user_conns.items():
                if (
                    exclude_connection is not None
                    and exclude_connection == (user_id, conn_id)
                ):
                    continue
                try:
                    await ws.send_text(payload)
                except Exception:
                    logger.exception(
                        "Failed to broadcast to user=%s conn=%s", user_id, conn_id
                    )
                    stale_pairs.append((user_id, conn_id))
        for stale_user_id, stale_conn_id in stale_pairs:
            user_conns = self._connections.get(stale_user_id)
            if user_conns is not None:
                user_conns.pop(stale_conn_id, None)
                if not user_conns:
                    del self._connections[stale_user_id]

    @property
    def connected_user_ids(self) -> list[str]:
        """Deduplicated list of user IDs with at least one active connection."""
        return list(self._connections.keys())

    def get_connections(self, user_id: str) -> dict[str, WebSocket]:
        """Return a shallow copy of ``connection_id -> WebSocket`` for a user."""
        return dict(self._connections.get(user_id, {}))

    def is_connection_active(self, user_id: str, connection_id: str) -> bool:
        """Check whether a specific connection is currently active for a user."""
        user_conns = self._connections.get(user_id)
        return user_conns is not None and connection_id in user_conns

    @property
    def total_connections(self) -> int:
        """Total number of active WebSocket connections across all users."""
        return sum(len(conns) for conns in self._connections.values())


ws_manager = ConnectionManager()
