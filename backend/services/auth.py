import logging
import random
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Protocol

import bcrypt
import jwt
from starlette.responses import JSONResponse

from constants import (
    AUTH_PROVIDER, JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE,
    JWT_EXPIRY_HOURS, JWT_SECRET_MIN_LENGTH, JWT_SECRET_FILE,
)
from database.models import TICK_SOUNDS
from database.repository import repo
from services.guard import guard

logger = logging.getLogger(__name__)

_jwt_secret: str | None = None

AUTH_EXEMPT_PREFIXES = (
    "/api/auth/",
    "/uploads/",
)


def _resolve_secret() -> str:
    global _jwt_secret
    if _jwt_secret:
        return _jwt_secret

    secret = JWT_SECRET
    secret_path = Path(JWT_SECRET_FILE)

    if secret:
        if len(secret) < JWT_SECRET_MIN_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {JWT_SECRET_MIN_LENGTH} characters"
            )
    elif secret_path.exists():
        secret = secret_path.read_text().strip()
    else:
        secret = secrets.token_urlsafe(48)
        secret_path.parent.mkdir(parents=True, exist_ok=True)
        secret_path.write_text(secret)
        secret_path.chmod(0o600)
        logger.info(f"Generated JWT secret and saved to {JWT_SECRET_FILE}")

    _jwt_secret = secret
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: str, user_name: str) -> str:
    secret = _resolve_secret()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "name": user_name,
        "jti": str(uuid.uuid4()),
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    secret = _resolve_secret()
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["sub", "name", "jti", "exp", "iat", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        logger.debug(f"JWT decode failed: {exc}")
        return None


class AuthProvider(Protocol):
    async def authenticate(self, name: str, password: str):
        ...

    async def register(self, name: str, password: str):
        ...


class LocalProvider:
    async def authenticate(self, name: str, password: str):
        user = await repo.get_user_by_name(name)
        if not user or not user.password_hash:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    async def register(self, name: str, password: str):
        pw_hash = hash_password(password)
        tick = random.choice(TICK_SOUNDS)
        return await repo.create_user(name, pw_hash, tick)


def _build_provider() -> AuthProvider:
    if AUTH_PROVIDER == "local":
        return LocalProvider()
    raise ValueError(f"Unknown AUTH_PROVIDER: {AUTH_PROVIDER!r} (supported: local)")


auth_provider = _build_provider()


class AuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http",):
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        if any(path.startswith(prefix) for prefix in AUTH_EXEMPT_PREFIXES):
            return await self.app(scope, receive, send)

        headers = dict(
            (k.decode(), v.decode()) for k, v in scope.get("headers", [])
        )
        auth_header = headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            response = JSONResponse(
                {"error": "Missing or invalid authorization header"}, status_code=401
            )
            return await response(scope, receive, send)

        token = auth_header[7:]
        payload = decode_token(token)
        if not payload:
            response = JSONResponse(
                {"error": "Invalid or expired token"}, status_code=401
            )
            return await response(scope, receive, send)

        if guard.is_jti_revoked(payload["jti"]):
            response = JSONResponse(
                {"error": "Token has been revoked"}, status_code=401
            )
            return await response(scope, receive, send)

        scope.setdefault("state", {})["current_user"] = {
            "id": payload["sub"], "name": payload["name"],
        }
        return await self.app(scope, receive, send)
