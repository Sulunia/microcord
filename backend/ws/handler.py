import json
import logging
from starlette.websockets import WebSocket, WebSocketDisconnect
from ws.manager import ws_manager
from services.voice_room import voice_room
from services.ws_ticket import redeem_ticket
from constants import MAX_WEBSOCKET_MESSAGE_SIZE

logger = logging.getLogger(__name__)


def _extract_user_id(websocket: WebSocket) -> str | None:
    ticket = websocket.query_params.get("ticket")
    if not ticket:
        return None
    return redeem_ticket(ticket)


async def websocket_endpoint(websocket: WebSocket):
    user_id = _extract_user_id(websocket)
    if not user_id:
        await websocket.close(code=4001)
        return

    await ws_manager.connect(user_id, websocket)

    if voice_room.sharer:
        await ws_manager.send_to(user_id, {
            "type": "screenshare_start",
            "data": {"user_id": voice_room.sharer},
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
                logger.warning(f"WS message too large from {user_id}: {len(raw)} bytes")
                continue

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            match msg.get("type"):
                case "screenshare_start":
                    await _handle_screenshare_start(user_id)
                case "screenshare_stop":
                    await _handle_screenshare_stop(user_id)
                case "screenshare_signal":
                    await _handle_screenshare_signal(user_id, msg.get("data", {}))
                case "screenshare_request":
                    await _handle_screenshare_request(user_id)
                case "voice_signal":
                    await _handle_voice_signal(user_id, msg.get("data", {}))
                case "voice_mute":
                    await _handle_voice_mute(user_id, msg.get("data", {}))
                case _:
                    pass

    except WebSocketDisconnect:
        pass
    finally:
        if voice_room.sharer == user_id:
            voice_room.stop_sharing(user_id)
            await ws_manager.broadcast(
                {"type": "screenshare_stop", "data": {"user_id": user_id}},
                exclude=user_id,
            )
        if voice_room.is_joined(user_id):
            voice_room.leave(user_id)
            await ws_manager.broadcast(
                {"type": "voice_participant_left", "data": {"user_id": user_id}},
                exclude=user_id,
            )
        ws_manager.disconnect(user_id)


async def _handle_screenshare_start(user_id: str):
    if not voice_room.start_sharing(user_id):
        await ws_manager.send_to(user_id, {
            "type": "screenshare_error",
            "data": {"error": "Someone is already sharing"},
        })
        return
    await ws_manager.broadcast(
        {"type": "screenshare_start", "data": {"user_id": user_id}},
        exclude=user_id,
    )


async def _handle_screenshare_stop(user_id: str):
    voice_room.stop_sharing(user_id)
    await ws_manager.broadcast(
        {"type": "screenshare_stop", "data": {"user_id": user_id}},
        exclude=user_id,
    )


async def _handle_screenshare_signal(user_id: str, data: dict):
    if not voice_room.is_joined(user_id):
        return
    target = data.get("target")
    signal = data.get("signal")
    if not target or not signal:
        return
    if not voice_room.is_joined(target):
        return
    await ws_manager.send_to(target, {
        "type": "screenshare_signal",
        "data": {"from": user_id, "signal": signal},
    })


async def _handle_screenshare_request(user_id: str):
    if not voice_room.is_joined(user_id):
        return
    sharer_id = voice_room.sharer
    if not sharer_id:
        return
    await ws_manager.send_to(sharer_id, {
        "type": "screenshare_request",
        "data": {"user_id": user_id},
    })


async def _handle_voice_signal(user_id: str, data: dict):
    if not voice_room.is_joined(user_id):
        return
    target = data.get("target")
    signal = data.get("signal")
    if not target or not signal:
        return
    if not voice_room.is_joined(target):
        return
    await ws_manager.send_to(target, {
        "type": "voice_signal",
        "data": {"from": user_id, "signal": signal},
    })


async def _handle_voice_mute(user_id: str, data: dict):
    if not voice_room.is_joined(user_id):
        return
    muted = bool(data.get("muted", False))
    voice_room.set_mute(user_id, muted)
    await ws_manager.broadcast(
        {"type": "voice_mute", "data": {"user_id": user_id, "muted": muted}},
    )
