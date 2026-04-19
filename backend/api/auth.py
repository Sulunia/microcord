import logging

from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request

from constants import AUTH_PROVIDER, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
from database.repository import repo
from services.auth import auth_provider, create_token, decode_token
from services.guard import guard, get_client_ip
from services.ws_ticket import create_ticket

logger = logging.getLogger(__name__)


def _get_ip() -> str:
    try:
        return get_client_ip(connexion_request.scope)
    except Exception:
        logger.exception("Failed to resolve client IP")
        return "unknown"


def _ratelimited(retry_after: float | None) -> ConnexionResponse | None:
    if retry_after is None:
        return None
    return ConnexionResponse(
        status_code=429,
        body={"error": f"Too many requests. Try again in {int(retry_after)} seconds."},
    )


async def register(body: dict) -> ConnexionResponse:
    ip = _get_ip()
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
        return ConnexionResponse(status_code=403, body={"error": "Invalid server passphrase"})

    user = await auth_provider.register(name, password)
    if user is None:
        return ConnexionResponse(status_code=409, body={"error": "Username already taken"})

    token = create_token(user.id, user.name)
    logger.info(f"Auth register: {user.name} ({user.id})")
    return ConnexionResponse(status_code=201, body={"user": user.to_dict(), "token": token})


async def login(body: dict) -> ConnexionResponse:
    ip = _get_ip()
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

    token = create_token(user.id, user.name)
    logger.info(f"Auth login: {user.name} ({user.id})")
    return ConnexionResponse(status_code=200, body={"user": user.to_dict(), "token": token})


async def me(**kwargs) -> ConnexionResponse:
    auth_header = kwargs.get("token_info") or {}
    user_id = auth_header.get("sub")

    if not user_id:
        scope = connexion_request.scope if hasattr(connexion_request, 'scope') else {}
        state = scope.get("state", {})
        current_user = state.get("current_user")
        if current_user:
            user_id = current_user["id"]

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
        scope = connexion_request.scope if hasattr(connexion_request, 'scope') else {}
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode()
        if not auth_header.startswith("Bearer "):
            return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
        payload = decode_token(auth_header[7:])
        if not payload:
            return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
        if guard.is_jti_revoked(payload["jti"]):
            return ConnexionResponse(status_code=401, body={"error": "Token has been revoked"})
        user_id = payload["sub"]
    ticket = create_ticket(user_id)
    return ConnexionResponse(status_code=200, body={"ticket": ticket})


async def logout(**kwargs) -> ConnexionResponse:
    scope = connexion_request.scope if hasattr(connexion_request, 'scope') else {}
    headers = dict(scope.get("headers", []))
    auth_header = headers.get(b"authorization", b"").decode()
    if not auth_header.startswith("Bearer "):
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    token = auth_header[7:]
    payload = decode_token(token)
    if not payload:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})
    guard.revoke_jti(payload["jti"], payload["exp"])
    logger.info("Auth logout: token revoked (jti=%s)", payload["jti"])
    return ConnexionResponse(status_code=200, body={"message": "Logged out"})
