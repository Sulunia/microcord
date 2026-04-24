import base64
import logging
import os
from datetime import datetime, timezone

from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request

from constants import (
    DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, MAX_MESSAGE_CONTENT_LENGTH,
    IMAGE_URL_PREFIX, UPLOAD_DIR,
)
from database.repository import repo
from services.media_manager import media_manager
from services.guard import guard
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


def _encode_cursor(created_at: datetime, msg_id: str) -> str:
    ts_us = int(created_at.timestamp() * 1_000_000)
    raw = f"{ts_us}|{msg_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    raw = base64.urlsafe_b64decode(cursor.encode()).decode()
    ts_str, msg_id = raw.split("|", 1)
    ts = datetime.fromtimestamp(int(ts_str) / 1_000_000, tz=timezone.utc)
    return ts, msg_id


def _get_current_user_id() -> str | None:
    try:
        scope = connexion_request.scope
        return scope.get("state", {}).get("current_user", {}).get("id")
    except Exception:
        logger.exception("Failed to get current user ID")
        return None


async def list_messages(limit: int = DEFAULT_MESSAGE_LIMIT, cursor: str | None = None) -> dict:
    limit = min(limit, MAX_MESSAGE_LIMIT)

    cursor_ts = None
    cursor_id = None
    if cursor:
        try:
            cursor_ts, cursor_id = _decode_cursor(cursor)
        except Exception:
            logger.exception(f"Invalid cursor: {cursor}")
            return {"messages": [], "next_cursor": None}

    rows, has_next = await repo.list_messages(limit, cursor_ts=cursor_ts, cursor_id=cursor_id)

    messages = [m.to_dict() for m in reversed(rows)]

    next_cursor = None
    if has_next and rows:
        oldest = rows[-1]
        next_cursor = _encode_cursor(oldest.created_at, oldest.id)

    return {"messages": messages, "next_cursor": next_cursor}


async def delete_message(message_id: str) -> ConnexionResponse:
    author_id = _get_current_user_id()
    if not author_id:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})

    msg = await repo.delete_message(message_id, author_id)
    if not msg:
        return ConnexionResponse(status_code=404, body={"error": "Message not found or not owned by you"})

    if msg.image_url:
        basename = os.path.basename(msg.image_url)
        filepath = os.path.join(UPLOAD_DIR, basename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                logger.warning(f"Failed to delete file: {filepath}")

    await ws_manager.broadcast({"type": "chat_message_deleted", "data": {"id": msg.id}})
    logger.info(f"Message deleted by {author_id}: {msg.id}")
    return ConnexionResponse(status_code=200, body={"id": msg.id})


async def send_message(body: dict) -> ConnexionResponse:
    author_id = _get_current_user_id()
    if not author_id:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})

    rl = guard.check_message(author_id)
    if rl is not None:
        return ConnexionResponse(
            status_code=429,
            body={"error": f"Too many messages. Try again in {int(rl)} seconds."},
        )

    content = body.get("content", "").strip()
    image_url = body.get("image_url")

    if image_url and not image_url.startswith(IMAGE_URL_PREFIX):
        return ConnexionResponse(status_code=400, body={"error": "Invalid image URL"})

    if not content and not image_url:
        return ConnexionResponse(status_code=400, body={"error": "Empty message"})

    if len(content) > MAX_MESSAGE_CONTENT_LENGTH:
        return ConnexionResponse(status_code=400, body={"error": f"Message too long (max {MAX_MESSAGE_CONTENT_LENGTH} characters)"})

    msg = await repo.create_message(author_id, content, image_url)
    result = msg.to_dict(include_author=True)
    logger.info(f"Message sent by {author_id}: {result['id']}")

    has_media = bool(result.get("image_url"))

    if has_media:
        filepath = os.path.join(UPLOAD_DIR, os.path.basename(result["image_url"]))
        if os.path.exists(filepath):
            await media_manager.enqueue(filepath, result["id"], author_id)
    else:
        await ws_manager.broadcast({"type": "chat_message", "data": result})

    return ConnexionResponse(status_code=201, body=result)
