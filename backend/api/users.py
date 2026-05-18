import hashlib
import logging
import secrets
from datetime import datetime, timezone, timedelta

from connexion.lifecycle import ConnexionResponse

from constants import DISPLAY_NAME_MAX_LENGTH, RECOVERY_PASSPHRASE_LENGTH, RECOVERY_EXPIRY_DAYS
from database.models import TICK_SOUNDS
from database.repository import repo
from services.auth import revoke_all_refresh_tokens
from services.guard import guard
from services.utils.request_context import current_user_id, current_user_is_admin, current_user_is_owner
from ws.manager import ws_manager

logger = logging.getLogger(__name__)


async def list_users() -> list[dict]:
    users = await repo.list_users()
    online_ids = set(ws_manager.connected_user_ids)
    return [{**u.to_public_dict(), "online": u.id in online_ids} for u in users]


async def get_online_users() -> dict:
    return {"user_ids": ws_manager.connected_user_ids}


async def get_user(user_id: str) -> ConnexionResponse:
    user = await repo.get_user_by_id(user_id)
    if not user:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})
    jwt_user_id = current_user_id()
    if jwt_user_id and jwt_user_id == user_id:
        return user.to_dict()
    return user.to_public_dict()


async def update_user(user_id: str, body: dict) -> ConnexionResponse:
    jwt_user_id = current_user_id()
    if jwt_user_id != user_id:
        return ConnexionResponse(status_code=403, body={"error": "Cannot modify another user's profile"})

    new_display_name = body.get("display_name", "").strip() if "display_name" in body else None
    new_tick_sound = body.get("tick_sound") if "tick_sound" in body else None

    if new_display_name is not None and len(new_display_name) > DISPLAY_NAME_MAX_LENGTH:
        return ConnexionResponse(status_code=400, body={"error": f"Display name too long (max {DISPLAY_NAME_MAX_LENGTH} characters)"})

    if new_tick_sound is not None and new_tick_sound not in TICK_SOUNDS:
        return ConnexionResponse(status_code=400, body={"error": "tick_sound must be 1, 2, 3, or 4"})

    user = await repo.update_user_profile(
        user_id,
        display_name=new_display_name if new_display_name else None,
        tick_sound=new_tick_sound,
    )
    if user is None:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    result = user.to_dict()
    await ws_manager.broadcast({
        "type": "user_updated",
        "data": {"user_id": user_id, "user": user.to_public_dict()},
    })

    logger.info(f"User updated: {result['display_name']} ({result['id']})")
    return ConnexionResponse(status_code=200, body=result)


async def set_user_admin(user_id: str, body: dict) -> ConnexionResponse:
    if not current_user_is_admin() and not current_user_is_owner():
        return ConnexionResponse(status_code=403, body={"error": "Admin access required"})

    is_admin = body.get("is_admin")
    if is_admin is None or not isinstance(is_admin, bool):
        return ConnexionResponse(status_code=400, body={"error": "is_admin (boolean) required"})

    target = await repo.get_user_by_id(user_id)
    if not target:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    if target.is_owner:
        return ConnexionResponse(status_code=403, body={"error": "Cannot modify server owner's admin status"})

    user = await repo.set_user_admin(user_id, is_admin)
    if user is None:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    guard.revoke_user_tokens(user_id)

    public_user = user.to_public_dict()
    await ws_manager.broadcast({
        "type": "user_updated",
        "data": {"user_id": user_id, "user": public_user},
    })

    logger.info(f"Admin status changed: {public_user['display_name']} ({public_user['id']}) -> is_admin={is_admin}")
    return ConnexionResponse(status_code=200, body=public_user)


async def recover_account(user_id: str) -> ConnexionResponse:
    if not current_user_is_owner():
        return ConnexionResponse(status_code=403, body={"error": "Owner access required"})

    target = await repo.get_user_by_id(user_id)
    if not target:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    passphrase = secrets.token_urlsafe(RECOVERY_PASSPHRASE_LENGTH)[:RECOVERY_PASSPHRASE_LENGTH]
    passphrase_hash = hashlib.sha256(passphrase.encode()).hexdigest()

    caller_id = current_user_id()
    is_self_recovery = caller_id == user_id

    if is_self_recovery:
        expires_at = None
    else:
        expires_at = datetime.now(timezone.utc) + timedelta(days=RECOVERY_EXPIRY_DAYS)

    user = await repo.set_recovery(user_id, passphrase_hash, expires_at)
    if user is None:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    if not is_self_recovery:
        await revoke_all_refresh_tokens(user_id)
        guard.revoke_user_tokens(user_id)

    await ws_manager.broadcast({
        "type": "user_updated",
        "data": {"user_id": user_id, "user": user.to_public_dict()},
    })

    logger.info(f"Account recovery initiated for {user.name} ({user.id}), self={is_self_recovery}")
    return ConnexionResponse(status_code=200, body={
        "recovery_passphrase": passphrase,
        "expires_at": expires_at.isoformat() if expires_at else None,
    })
