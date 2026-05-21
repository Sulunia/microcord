import logging

from connexion.lifecycle import ConnexionResponse

from database.repository import repo
from services.utils.request_context import current_user
from services.voice_room import voice_room_manager
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


async def _resolve_participants(channel_id: str) -> list[dict]:
    room = voice_room_manager.get_room(channel_id)
    if not room:
        return []
    participant_ids = room.user_ids
    if not participant_ids:
        return []
    users = await repo.get_users_by_ids(participant_ids)
    return [
        {
            "user_id": user_id,
            "name": users[user_id].effective_name if user_id in users else user_id,
            "avatar_url": users[user_id].avatar_url if user_id in users else None,
            "sharing": user_id == room.sharer,
            "muted": room.is_muted(user_id),
            "speaking": room.is_speaking(user_id),
            "channel_id": channel_id,
        }
        for user_id in participant_ids
    ]


async def join_voice(body: dict) -> ConnexionResponse:
    """Join a voice channel.

    Optionally accepts a ``connection_id`` and ``channel_id`` in the
    request body.  ``channel_id`` selects which voice channel to join and
    defaults to the first available voice channel.  ``connection_id``
    associates the voice seat with a specific WebSocket connection
    (multi-session support).  If the user is already in voice, returns
    **409 Conflict**.
    """
    jwt_user = current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    user_id = jwt_user["id"]

    user = await repo.get_user_by_id(user_id)
    if not user:
        return ConnexionResponse(status_code=400, body={"error": "Unknown user"})

    connection_id: str | None = body.get("connection_id")
    if connection_id is not None:
        if not isinstance(connection_id, str) or not connection_id:
            return ConnexionResponse(
                status_code=400,
                body={"error": "connection_id must be a non-empty string"},
            )
        if not ws_manager.is_connection_active(user_id, connection_id):
            logger.warning(
                "Voice join rejected: user=%s provided inactive connection_id=%s",
                user_id,
                connection_id,
            )
            return ConnexionResponse(
                status_code=400,
                body={"error": "Invalid connection_id"},
            )

    # Resolve channel_id — default to first voice channel if not provided
    channel_id: str | None = body.get("channel_id")
    if not channel_id:
        voice_channels = await repo.list_voice_channels()
        if not voice_channels:
            return ConnexionResponse(
                status_code=400,
                body={"error": "No voice channels available"},
            )
        channel_id = voice_channels[0].id

    if voice_room_manager.is_in_voice(user_id):
        logger.info(
            "Voice join rejected: user=%s already in voice (existing_channel=%s, new_channel=%s, new_conn=%s)",
            user_id,
            voice_room_manager.user_channel(user_id),
            channel_id,
            connection_id,
        )
        return ConnexionResponse(
            status_code=409,
            body={"error": "Already joined voice on another device"},
        )

    voice_room_manager.join_channel(channel_id, user_id, connection_id)

    await ws_manager.broadcast(
        {"type": "voice_participant_joined", "data": {"user_id": user_id, "channel_id": channel_id}},
        exclude_user=user_id,
    )
    await ws_manager.send_to(user_id, {
        "type": "voice_participant_joined",
        "data": {"user_id": user_id, "connection_id": connection_id, "channel_id": channel_id},
    })

    participants = await _resolve_participants(channel_id)
    return ConnexionResponse(status_code=200, body={"participants": participants})


async def leave_voice(body: dict) -> ConnexionResponse:
    """Leave the voice channel."""
    jwt_user = current_user()
    if not jwt_user:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    user_id = jwt_user["id"]

    # Look up the user's current channel before leaving
    current_channel_id = voice_room_manager.user_channel(user_id)
    room = voice_room_manager.room_for_user(user_id)

    voice_connection_id = room.voice_connection_id(user_id) if room else None
    was_sharing = room is not None and room.sharer == user_id

    left_room, removed = voice_room_manager.leave_channel(user_id)
    if not removed:
        return ConnexionResponse(status_code=404, body={"error": "User not in voice"})

    if was_sharing:
        await ws_manager.broadcast(
            {"type": "screenshare_stop", "data": {"user_id": user_id, "channel_id": current_channel_id}},
            exclude_user=user_id,
        )

    await ws_manager.broadcast(
        {"type": "voice_participant_left", "data": {"user_id": user_id, "channel_id": current_channel_id}},
        exclude_user=user_id,
    )
    await ws_manager.send_to(user_id, {
        "type": "voice_participant_left",
        "data": {"user_id": user_id, "connection_id": voice_connection_id, "channel_id": current_channel_id},
    })

    return ConnexionResponse(status_code=200, body={})


async def get_participants() -> list[dict]:
    jwt_user = current_user()
    if not jwt_user:
        return []
    user_id = jwt_user.get("id")
    if not user_id:
        return []
    channel_id = voice_room_manager.user_channel(user_id)
    if not channel_id:
        return []
    return await _resolve_participants(channel_id)
