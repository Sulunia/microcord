import logging
from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request
from sqlalchemy import select
from models.user import User
from models.base import get_read_session
from services.db_writer import enqueue_write
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


def _get_current_user_id() -> str | None:
    try:
        scope = connexion_request.scope
        return scope.get("state", {}).get("current_user", {}).get("id")
    except Exception:
        return None


async def list_users() -> list[dict]:
    factory = get_read_session()
    async with factory() as session:
        result = await session.execute(select(User).order_by(User.created_at))
        return [u.to_dict() for u in result.scalars().all()]


async def get_user(user_id: str) -> ConnexionResponse:
    factory = get_read_session()
    async with factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return ConnexionResponse(status_code=404, body={"error": "User not found"})
        return user.to_dict()


async def update_user(user_id: str, body: dict) -> ConnexionResponse:
    jwt_user_id = _get_current_user_id()
    if jwt_user_id != user_id:
        return ConnexionResponse(status_code=403, body={"error": "Cannot modify another user's profile"})

    new_display_name = body.get("display_name", "").strip() if "display_name" in body else None
    new_tick_sound = body.get("tick_sound") if "tick_sound" in body else None

    if new_display_name is not None and len(new_display_name) > 40:
        return ConnexionResponse(status_code=400, body={"error": "Display name too long (max 40 characters)"})

    if new_tick_sound is not None and new_tick_sound not in (1, 2, 3, 4):
        return ConnexionResponse(status_code=400, body={"error": "tick_sound must be 1, 2, 3, or 4"})

    async def _write(session):
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return None

        if new_display_name:
            user.display_name = new_display_name

        if new_tick_sound is not None:
            user.tick_sound = new_tick_sound

        await session.flush()
        await session.refresh(user)
        return user.to_dict()

    result = await enqueue_write(_write)
    if result is None:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    await ws_manager.broadcast({
        "type": "user_updated",
        "data": {"user_id": user_id, "user": result},
    })

    logger.info(f"User updated: {result['display_name']} ({result['id']})")
    return ConnexionResponse(status_code=200, body=result)
