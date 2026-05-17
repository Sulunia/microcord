import logging
import os

from connexion.lifecycle import ConnexionResponse

from constants import MAX_CHANNELS, UPLOAD_DIR
from database.repository import repo
from services.utils.request_context import current_user_is_admin
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


async def list_channels() -> dict:
    channels = await repo.list_channels()
    return {"channels": [c.to_dict() for c in channels]}


async def create_channel(body: dict) -> ConnexionResponse:
    if not current_user_is_admin():
        return ConnexionResponse(status_code=403, body={"error": "Admin access required"})

    name = body.get("name", "").strip()
    if not name or len(name) > 40:
        return ConnexionResponse(status_code=400, body={"error": "Channel name must be 1-40 characters"})

    count = await repo.count_channels()
    if count >= MAX_CHANNELS:
        return ConnexionResponse(status_code=400, body={"error": f"Maximum {MAX_CHANNELS} channels reached"})

    existing = await repo.list_channels()
    if any(c.name.lower() == name.lower() for c in existing):
        return ConnexionResponse(status_code=409, body={"error": "Channel name already exists"})

    channel = await repo.create_channel(name)
    result = channel.to_dict()

    await ws_manager.broadcast({"type": "channel_created", "data": {"channel": result}})

    logger.info(f"Channel created: {name} ({channel.id})")
    return ConnexionResponse(status_code=201, body=result)


async def update_channel(channel_id: str, body: dict) -> ConnexionResponse:
    if not current_user_is_admin():
        return ConnexionResponse(status_code=403, body={"error": "Admin access required"})

    name = body.get("name", "").strip()
    if not name or len(name) > 40:
        return ConnexionResponse(status_code=400, body={"error": "Channel name must be 1-40 characters"})

    existing_ch = await repo.get_channel(channel_id)
    if not existing_ch:
        return ConnexionResponse(status_code=404, body={"error": "Channel not found"})

    if existing_ch.is_default:
        return ConnexionResponse(status_code=400, body={"error": "Cannot rename the default channel"})

    all_channels = await repo.list_channels()
    if any(c.name.lower() == name.lower() and c.id != channel_id for c in all_channels):
        return ConnexionResponse(status_code=409, body={"error": "Channel name already exists"})

    channel = await repo.update_channel(channel_id, name)
    if not channel:
        return ConnexionResponse(status_code=404, body={"error": "Channel not found"})

    result = channel.to_dict()
    await ws_manager.broadcast({"type": "channel_updated", "data": {"channel": result}})

    logger.info(f"Channel renamed: {channel_id} -> {name}")
    return ConnexionResponse(status_code=200, body=result)


async def delete_channel(channel_id: str) -> ConnexionResponse:
    if not current_user_is_admin():
        return ConnexionResponse(status_code=403, body={"error": "Admin access required"})

    existing_ch = await repo.get_channel(channel_id)
    if not existing_ch:
        return ConnexionResponse(status_code=404, body={"error": "Channel not found"})

    if existing_ch.is_default:
        return ConnexionResponse(status_code=400, body={"error": "Cannot delete the default channel"})

    channel, image_urls = await repo.delete_channel(channel_id)
    if not channel:
        return ConnexionResponse(status_code=404, body={"error": "Channel not found"})

    for image_url in image_urls:
        basename = os.path.basename(image_url)
        filepath = os.path.join(UPLOAD_DIR, basename)
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                logger.warning(f"Failed to delete file: {filepath}")

    await ws_manager.broadcast({"type": "channel_deleted", "data": {"channel_id": channel_id}})

    logger.info(f"Channel deleted: {channel_id}")
    return ConnexionResponse(status_code=200, body={"id": channel_id})
