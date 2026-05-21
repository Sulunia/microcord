import json
import logging

from starlette.websockets import WebSocket, WebSocketDisconnect

from ws.manager import ws_manager
from services.voice_room import voice_room_manager
from services.ws_ticket import redeem_ticket
from database.repository import repo
from constants import MAX_WEBSOCKET_MESSAGE_SIZE

logger = logging.getLogger(__name__)


def _extract_user_id(websocket: WebSocket) -> str | None:
    ticket = websocket.query_params.get("ticket")
    if not ticket:
        return None
    return redeem_ticket(ticket)


def _is_voice_owner(user_id: str, connection_id: str) -> bool:
    """Check whether *connection_id* holds the voice seat for *user_id*.

    If the voice seat was established without a ``connection_id`` (legacy
    client), the disconnecting connection is assumed to own it so that
    cleanup still works.
    """
    room = voice_room_manager.room_for_user(user_id)
    if room is None:
        return False
    voice_conn = room.voice_connection_id(user_id)
    return voice_conn is None or voice_conn == connection_id


async def websocket_endpoint(websocket: WebSocket):
    user_id = _extract_user_id(websocket)
    if not user_id:
        await websocket.close(code=4001)
        return

    connection_id = await ws_manager.connect(user_id, websocket)
    if connection_id is None:
        return

    user_obj = await repo.get_user_by_id(user_id)
    user_data = user_obj.to_public_dict() if user_obj else {"id": user_id}

    channels = await repo.list_channels()
    voice_channels = await repo.list_voice_channels()

    await ws_manager.send_to_connection(
        user_id,
        connection_id,
        {
            "type": "presence_init",
            "data": {
                "user_ids": ws_manager.connected_user_ids,
                "connection_id": connection_id,
                "channels": [c.to_dict() for c in channels],
                "voice_channels": [vc.to_dict() for vc in voice_channels],
            },
        },
    )

    await ws_manager.broadcast(
        {"type": "presence_online", "data": {"user_id": user_id, "user": user_data}},
        exclude_user=user_id,
    )

    # Notify the new connection about active screenshares across all rooms
    for room_id in voice_room_manager.all_room_ids():
        room = voice_room_manager.get_room(room_id)
        if room and room.sharer:
            await ws_manager.send_to(user_id, {
                "type": "screenshare_start",
                "data": {"user_id": room.sharer, "channel_id": room_id},
            })

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            raw = message.get("text")
            if not raw:
                continue

            if len(raw) > MAX_WEBSOCKET_MESSAGE_SIZE:
                logger.warning(
                    "WS message too large from user=%s conn=%s: %d bytes",
                    user_id,
                    connection_id,
                    len(raw),
                )
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            match msg.get("type"):
                case "screenshare_start":
                    await _handle_screenshare_start(user_id, connection_id)
                case "screenshare_stop":
                    await _handle_screenshare_stop(user_id, connection_id)
                case "screenshare_signal":
                    await _handle_screenshare_signal(user_id, connection_id, msg.get("data", {}))
                case "screenshare_request":
                    await _handle_screenshare_request(user_id, connection_id)
                case "voice_signal":
                    await _handle_voice_signal(user_id, connection_id, msg.get("data", {}))
                case "voice_mute":
                    await _handle_voice_mute(user_id, connection_id, msg.get("data", {}))
                case "voice_speaking":
                    await _handle_voice_speaking(user_id, connection_id, msg.get("data", {}))
                case _:
                    pass

    except WebSocketDisconnect:
        pass
    finally:
        room = voice_room_manager.room_for_user(user_id)
        current_channel_id = voice_room_manager.user_channel(user_id)

        if room and room.sharer == user_id:
            if room.stop_sharing(user_id, connection_id):
                await ws_manager.broadcast(
                    {"type": "screenshare_stop", "data": {"user_id": user_id, "channel_id": current_channel_id}},
                    exclude_user=user_id,
                )

        if voice_room_manager.is_in_voice(user_id) and _is_voice_owner(user_id, connection_id):
            voice_room_manager.leave_channel(user_id)
            await ws_manager.broadcast(
                {"type": "voice_participant_left", "data": {"user_id": user_id, "channel_id": current_channel_id}},
                exclude_user=user_id,
            )
            await ws_manager.send_to(user_id, {
                "type": "voice_participant_left",
                "data": {"user_id": user_id, "connection_id": connection_id, "channel_id": current_channel_id},
            })

        is_last = ws_manager.disconnect(user_id, connection_id)
        if is_last:
            await ws_manager.broadcast(
                {"type": "presence_offline", "data": {"user_id": user_id}},
            )


async def _handle_screenshare_start(user_id: str, connection_id: str):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    channel_id = voice_room_manager.user_channel(user_id)
    if not room.start_sharing(user_id, connection_id):
        await ws_manager.send_to_connection(user_id, connection_id, {
            "type": "screenshare_error",
            "data": {"error": "Someone is already sharing"},
        })
        return
    await ws_manager.broadcast(
        {"type": "screenshare_start", "data": {"user_id": user_id, "channel_id": channel_id}},
        exclude_user=user_id,
    )


async def _handle_screenshare_stop(user_id: str, connection_id: str):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    channel_id = voice_room_manager.user_channel(user_id)
    if room.stop_sharing(user_id, connection_id):
        await ws_manager.broadcast(
            {"type": "screenshare_stop", "data": {"user_id": user_id, "channel_id": channel_id}},
            exclude_user=user_id,
        )


async def _handle_screenshare_signal(
    user_id: str, connection_id: str, data: dict
):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    if not _is_voice_owner(user_id, connection_id):
        logger.debug(
            "Screenshare signal rejected for user=%s conn=%s: not voice owner",
            user_id,
            connection_id,
        )
        return
    target = data.get("target")
    signal = data.get("signal")
    if not target or not signal:
        return
    if not room.is_joined(target):
        return
    channel_id = voice_room_manager.user_channel(user_id)
    await ws_manager.send_to(target, {
        "type": "screenshare_signal",
        "data": {"from": user_id, "signal": signal, "channel_id": channel_id},
    })


async def _handle_screenshare_request(
    user_id: str, connection_id: str
):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    if not _is_voice_owner(user_id, connection_id):
        logger.debug(
            "Screenshare request rejected for user=%s conn=%s: not voice owner",
            user_id,
            connection_id,
        )
        return
    sharer_id = room.sharer
    if not sharer_id:
        return
    channel_id = voice_room_manager.user_channel(user_id)
    await ws_manager.send_to(sharer_id, {
        "type": "screenshare_request",
        "data": {"user_id": user_id, "channel_id": channel_id},
    })


async def _handle_voice_signal(user_id: str, connection_id: str, data: dict):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    if not _is_voice_owner(user_id, connection_id):
        logger.debug(
            "Voice signal rejected for user=%s conn=%s: not voice owner",
            user_id,
            connection_id,
        )
        return
    target = data.get("target")
    signal = data.get("signal")
    if not target or not signal:
        return
    if not room.is_joined(target):
        return
    channel_id = voice_room_manager.user_channel(user_id)
    await ws_manager.send_to(target, {
        "type": "voice_signal",
        "data": {"from": user_id, "signal": signal, "channel_id": channel_id},
    })


async def _handle_voice_mute(user_id: str, connection_id: str, data: dict):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    if not _is_voice_owner(user_id, connection_id):
        logger.debug(
            "Voice mute rejected for user=%s conn=%s: not voice owner",
            user_id,
            connection_id,
        )
        return
    muted = bool(data.get("muted", False))
    room.set_mute(user_id, muted)
    channel_id = voice_room_manager.user_channel(user_id)
    await ws_manager.broadcast(
        {"type": "voice_mute", "data": {"user_id": user_id, "muted": muted, "channel_id": channel_id}},
    )


async def _handle_voice_speaking(user_id: str, connection_id: str, data: dict):
    room = voice_room_manager.room_for_user(user_id)
    if not room:
        return
    if not _is_voice_owner(user_id, connection_id):
        logger.debug(
            "Voice speaking rejected for user=%s conn=%s: not voice owner",
            user_id,
            connection_id,
        )
        return
    speaking = bool(data.get("speaking", False))
    room.set_speaking(user_id, speaking)
    channel_id = voice_room_manager.user_channel(user_id)
    await ws_manager.broadcast(
        {"type": "voice_speaking", "data": {"user_id": user_id, "speaking": speaking, "channel_id": channel_id}},
    )
