import hashlib
import hmac
import logging

from connexion.lifecycle import ConnexionResponse

from constants import AUTH_PROVIDER, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
from database.repository import repo
from services.auth import (
    auth_provider, create_access_token, create_refresh_token,
    rotate_refresh_token, revoke_all_refresh_tokens, decode_token,
    hash_password, _user_role,
)
from services.guard import guard
from services.utils.request_context import client_ip, authorization_bearer, current_user_id
from services.ws_ticket import create_ticket

logger = logging.getLogger(__name__)


def _ratelimited(retry_after: float | None) -> ConnexionResponse | None:
    if retry_after is None:
        return None
    return ConnexionResponse(
        status_code=429,
        body={"error": f"Too many requests. Try again in {int(retry_after)} seconds."},
    )


async def _try_account_recovery(name: str, password: str, passphrase: str) -> ConnexionResponse | None:
    """Verify a recovery passphrase for an existing user and reset their password.

    Returns a ConnexionResponse on recovery hit (200 on success, 403 on
    expired/invalid), or None if the user has no pending recovery.
    """
    from datetime import datetime, timezone

    existing = await repo.get_user_by_name(name)
    if not existing or not existing.recovery_hash:
        return None

    if existing.recovery_expires_at is not None and existing.recovery_expires_at < datetime.now(timezone.utc):
        return ConnexionResponse(status_code=403, body={"error": "Recovery passphrase expired"})

    provided_hash = hashlib.sha256(passphrase.encode()).hexdigest()
    if not hmac.compare_digest(provided_hash, existing.recovery_hash):
        return ConnexionResponse(status_code=403, body={"error": "Invalid recovery passphrase"})

    new_password_hash = hash_password(password)
    user = await repo.recover_user(existing.id, new_password_hash)
    if user is None:
        return ConnexionResponse(status_code=500, body={"error": "Recovery failed"})

    access_token = create_access_token(user.id, user.name, role=_user_role(user))
    refresh_token = await create_refresh_token(user.id)
    logger.info(f"Auth recovery: {user.name} ({user.id})")
    return ConnexionResponse(status_code=200, body={
        "user": user.to_dict(),
        "access_token": access_token,
        "refresh_token": refresh_token,
    })


async def register(body: dict) -> ConnexionResponse:
    ip = client_ip()
    rl = _ratelimited(guard.check_register(ip))
    if rl:
        return rl

    name = body.get("name", "").strip()
    password = body.get("password", "")
    passphrase = body.get("passphrase", "")

    if not name or not password:
        return ConnexionResponse(status_code=400, body={"error": "Name and password required"})
    if len(password) < PASSWORD_MIN_LENGTH:
        return ConnexionResponse(status_code=400, body={"error": f"Password must be at least {PASSWORD_MIN_LENGTH} characters"})
    if len(password) > PASSWORD_MAX_LENGTH:
        return ConnexionResponse(status_code=400, body={"error": f"Password too long (max {PASSWORD_MAX_LENGTH} characters)"})

    if not guard.verify_passphrase(passphrase):
        recovery = await _try_account_recovery(name, password, passphrase)
        if recovery is not None:
            return recovery
        return ConnexionResponse(status_code=403, body={"error": "Invalid server passphrase"})

    user = await auth_provider.register(name, password)
    if user is None:
        return ConnexionResponse(status_code=409, body={"error": "Username already taken"})

    access_token = create_access_token(user.id, user.name, role=_user_role(user))
    refresh_token = await create_refresh_token(user.id)
    logger.info(f"Auth register: {user.name} ({user.id})")
    return ConnexionResponse(status_code=201, body={
        "user": user.to_dict(),
        "access_token": access_token,
        "refresh_token": refresh_token,
    })


async def login(body: dict) -> ConnexionResponse:
    ip = client_ip()
    rl = _ratelimited(guard.check_login(ip))
    if rl:
        return rl

    name = body.get("name", "").strip()
    password = body.get("password", "")

    if not name or not password:
        return ConnexionResponse(status_code=400, body={"error": "Name and password required"})

    user = await auth_provider.authenticate(name, password)
    if user is None:
        return ConnexionResponse(status_code=401, body={"error": "Invalid credentials"})

    access_token = create_access_token(user.id, user.name, role=_user_role(user))
    refresh_token = await create_refresh_token(user.id)
    logger.info(f"Auth login: {user.name} ({user.id})")
    return ConnexionResponse(status_code=200, body={
        "user": user.to_dict(),
        "access_token": access_token,
        "refresh_token": refresh_token,
    })


async def refresh(body: dict) -> ConnexionResponse:
    ip = client_ip()
    rl = _ratelimited(guard.check_refresh(ip))
    if rl:
        return rl

    raw_token = body.get("refresh_token", "")
    if not raw_token:
        return ConnexionResponse(status_code=400, body={"error": "refresh_token required"})

    result = await rotate_refresh_token(raw_token)
    if result is None:
        return ConnexionResponse(status_code=401, body={"error": "Invalid or expired refresh token"})

    access_token, new_refresh_token = result
    return ConnexionResponse(status_code=200, body={
        "access_token": access_token,
        "refresh_token": new_refresh_token,
    })


async def me(**kwargs) -> ConnexionResponse:
    auth_header = kwargs.get("token_info") or {}
    user_id = auth_header.get("sub")

    if not user_id:
        user_id = current_user_id()

    if not user_id:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})

    user = await repo.get_user_by_id(user_id)
    if not user:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})
    return user.to_dict()


async def status() -> dict:
    return {"provider": AUTH_PROVIDER}


async def ws_ticket(**kwargs) -> ConnexionResponse:
    token_info = kwargs.get("token_info")
    if token_info and token_info.get("sub"):
        user_id = token_info["sub"]
        jti = token_info.get("jti")
        if jti and guard.is_jti_revoked(jti):
            return ConnexionResponse(status_code=401, body={"error": "Token has been revoked"})
    else:
        token = authorization_bearer()
        if not token:
            return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
        payload = decode_token(token)
        if not payload:
            return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
        if guard.is_jti_revoked(payload["jti"]):
            return ConnexionResponse(status_code=401, body={"error": "Token has been revoked"})
        user_id = payload["sub"]
    ticket = create_ticket(user_id)
    return ConnexionResponse(status_code=200, body={"ticket": ticket})


async def logout(**kwargs) -> ConnexionResponse:
    token = authorization_bearer()
    if not token:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    payload = decode_token(token)
    if not payload:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    guard.revoke_jti(payload["jti"], payload["exp"])
    await revoke_all_refresh_tokens(payload["sub"])
    logger.info("Auth logout: token revoked (jti=%s)", payload["jti"])
    return ConnexionResponse(status_code=200, body={"message": "Logged out"})
