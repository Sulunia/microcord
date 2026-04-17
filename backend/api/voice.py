import logging
from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request
from sqlalchemy import select
from models.user import User
from models.base import get_read_session
from services.voice_room import voice_room
from ws.manager import ws_manager
from constants import ICE_SERVERS

logger = logging.getLogger(__name__)


def _get_current_user() -> dict | None:
    try:
        scope = connexion_request.scope
        return scope.get("state", {}).get("current_user")
    except Exception:
        return None


async def _resolve_participants() -> list[dict]:
    """Build participant list with fresh display names from DB."""
    ids = voice_room.user_ids
    if not ids:
        return []
    factory = get_read_session()
    async with factory() as session:
        result = await session.execute(select(User).where(User.id.in_(ids)))
        users = {u.id: u for u in result.scalars().all()}
    return [
        {
            "user_id": uid,
            "name": users[uid].effective_name if uid in users else uid,
            "avatar_url": users[uid].avatar_url if uid in users else None,
            "sharing": uid == voice_room.sharer,
        }
        for uid in ids
    ]


async def join_voice(body: dict) -> ConnexionResponse:
    jwt_user = _get_current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    user_id = jwt_user["id"]

    factory = get_read_session()
    async with factory() as session:
        result = await session.execute(select(User).where(User.id == user_id))
        if not result.scalar_one_or_none():
            return ConnexionResponse(status_code=400, body={"error": "Unknown user"})

    voice_room.join(user_id)

    await ws_manager.broadcast(
        {"type": "voice_participant_joined", "data": {"user_id": user_id}},
        exclude=user_id,
    )

    participants = await _resolve_participants()
    return ConnexionResponse(status_code=200, body={"participants": participants})


async def leave_voice(body: dict) -> ConnexionResponse:
    jwt_user = _get_current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    user_id = jwt_user["id"]

    was_sharing = voice_room.sharer == user_id
    removed = voice_room.leave(user_id)
    if not removed:
        return ConnexionResponse(status_code=404, body={"error": "User not in voice"})

    if was_sharing:
        await ws_manager.broadcast(
            {"type": "screenshare_stop", "data": {"user_id": user_id}},
            exclude=user_id,
        )

    await ws_manager.broadcast(
        {"type": "voice_participant_left", "data": {"user_id": user_id}},
        exclude=user_id,
    )

    return ConnexionResponse(status_code=200, body={})


async def get_participants() -> list[dict]:
    return await _resolve_participants()


async def get_voice_config() -> dict:
    return {"ice_servers": ICE_SERVERS}
