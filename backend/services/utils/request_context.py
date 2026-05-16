import logging

from connexion import request as connexion_request

from services.guard import get_client_ip

logger = logging.getLogger(__name__)


def current_user() -> dict | None:
    try:
        return connexion_request.scope.get("state", {}).get("current_user")
    except Exception:
        logger.exception("Failed to get current user")
        return None


def current_user_id() -> str | None:
    user = current_user()
    return user.get("id") if user else None


def current_user_is_admin() -> bool:
    user = current_user()
    return user.get("is_admin", False) if user else False


def current_user_is_owner() -> bool:
    user = current_user()
    return user.get("is_owner", False) if user else False


def authorization_bearer() -> str | None:
    try:
        scope = connexion_request.scope
    except Exception:
        return None
    headers = dict(scope.get("headers", []))
    raw = headers.get(b"authorization", b"").decode()
    return raw[7:] if raw.startswith("Bearer ") else None


def client_ip() -> str:
    try:
        return get_client_ip(connexion_request.scope)
    except Exception:
        logger.exception("Failed to resolve client IP")
        return "unknown"
