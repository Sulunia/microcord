import logging

from connexion.lifecycle import ConnexionResponse

from database.repository import repo
from services.utils.request_context import current_user, current_user_is_admin, current_user_is_owner
from services.voice_room import voice_room_manager
from ws.manager import ws_manager
from constants import MAX_VOICE_CHANNEL_NAME_LENGTH, MAX_VOICE_CHANNELS

logger = logging.getLogger(__name__)


def _is_admin_or_owner() -> bool:
    return current_user_is_admin() or current_user_is_owner()


async def create_voice_channel(body: dict) -> ConnexionResponse:
    jwt_user = current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    user_id = jwt_user["id"]
    if not _is_admin_or_owner():
        return ConnexionResponse(status_code=403, body={"error": "Admin or owner access required"})
    name = body.get("name", "").strip()
    if not name or len(name) > MAX_VOICE_CHANNEL_NAME_LENGTH:
        return ConnexionResponse(status_code=400, body={"error": f"Name must be 1-{MAX_VOICE_CHANNEL_NAME_LENGTH} characters"})
    count = await repo.count_voice_channels()
    if count >= MAX_VOICE_CHANNELS:
        return ConnexionResponse(status_code=400, body={"error": "Maximum voice channels reached"})
    vc = await repo.create_voice_channel(name, user_id)
    if not vc:
        return ConnexionResponse(status_code=409, body={"error": "Voice channel name already exists"})
    await ws_manager.broadcast({"type": "voice_channel_created", "data": vc.to_dict()})
    return ConnexionResponse(status_code=201, body=vc.to_dict())


async def list_voice_channels() -> list[dict]:
    channels = await repo.list_voice_channels()
    result = []
    for vc in channels:
        d = vc.to_dict()
        d["participant_count"] = voice_room_manager.room_participant_count(vc.id)
        result.append(d)
    return result


async def delete_voice_channel(channel_id: str) -> ConnexionResponse:
    jwt_user = current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    if not _is_admin_or_owner():
        return ConnexionResponse(status_code=403, body={"error": "Admin or owner access required"})
    # Check there's more than one channel
    count = await repo.count_voice_channels()
    if count <= 1:
        return ConnexionResponse(status_code=400, body={"error": "Cannot delete the last voice channel"})
    vc = await repo.delete_voice_channel(channel_id)
    if not vc:
        return ConnexionResponse(status_code=404, body={"error": "Voice channel not found"})
    # Evict participants from in-memory room
    voice_room_manager.remove_room(channel_id)
    await ws_manager.broadcast({"type": "voice_channel_deleted", "data": {"id": channel_id}})
    return ConnexionResponse(status_code=200, body={"id": channel_id})
