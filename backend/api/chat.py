import base64
import logging
from datetime import datetime, timezone
from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request
from sqlalchemy import select, or_, and_
from models.message import Message
from models.base import get_read_session
from services.db_writer import enqueue_write
from ws.manager import ws_manager
from constants import DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT, MAX_MESSAGE_CONTENT_LENGTH, IMAGE_URL_PREFIX
from services.guard import guard

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
        return None


async def list_messages(limit: int = DEFAULT_MESSAGE_LIMIT, cursor: str | None = None) -> dict:
    limit = min(limit, MAX_MESSAGE_LIMIT)
    factory = get_read_session()
    async with factory() as session:
        query = (
            select(Message)
            .order_by(Message.created_at.desc(), Message.id.desc())
        )

        if cursor:
            try:
                cursor_ts, cursor_id = _decode_cursor(cursor)
            except Exception:
                return {"messages": [], "next_cursor": None}
            query = query.where(
                or_(
                    Message.created_at < cursor_ts,
                    and_(Message.created_at == cursor_ts, Message.id < cursor_id),
                )
            )

        query = query.limit(limit + 1)
        result = await session.execute(query)
        rows = result.scalars().all()

        has_next = len(rows) > limit
        if has_next:
            rows = rows[:limit]

        messages = [m.to_dict() for m in reversed(rows)]

        next_cursor = None
        if has_next and rows:
            oldest = rows[-1]
            next_cursor = _encode_cursor(oldest.created_at, oldest.id)

        return {"messages": messages, "next_cursor": next_cursor}


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

    async def _write(session):
        msg = Message(author_id=author_id, content=content, image_url=image_url)
        session.add(msg)
        await session.flush()
        await session.refresh(msg, attribute_names=["author"])
        return msg.to_dict(include_author=True)

    result = await enqueue_write(_write)
    logger.info(f"Message sent by {author_id}: {result['id']}")

    await ws_manager.broadcast({"type": "chat_message", "data": result})

    return ConnexionResponse(status_code=201, body=result)
