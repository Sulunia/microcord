import logging
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Protocol

import bcrypt
import jwt
from starlette.responses import JSONResponse
from sqlalchemy import select

from constants import (
    AUTH_PROVIDER, JWT_SECRET, JWT_ALGORITHM, JWT_ISSUER, JWT_AUDIENCE,
    JWT_EXPIRY_HOURS, JWT_SECRET_MIN_LENGTH, JWT_SECRET_FILE,
)
from services.guard import guard

logger = logging.getLogger(__name__)

_jwt_secret: str | None = None

AUTH_EXEMPT_PREFIXES = (
    "/api/auth/",
    # "/api/ui",
    # "/api/openapi",
    "/uploads/",
)


def _resolve_secret() -> str:
    """Resolve JWT secret: env var > file > auto-generate."""
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
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict | None:
    """Decode and validate a JWT. Returns payload dict or None on failure."""
    secret = _resolve_secret()
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["sub", "name", "exp", "iat", "iss", "aud"]},
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
    """Authenticates against bcrypt password_hash stored in User model."""

    async def authenticate(self, name: str, password: str):
        from models.user import User
        from models.base import get_read_session

        factory = get_read_session()
        async with factory() as session:
            result = await session.execute(select(User).where(User.name == name))
            user = result.scalar_one_or_none()
            if not user or not user.password_hash:
                return None
            if not verify_password(password, user.password_hash):
                return None
            return user

    async def register(self, name: str, password: str):
        import random
        from models.user import User, TICK_SOUNDS
        from services.db_writer import enqueue_write

        pw_hash = hash_password(password)
        tick = random.choice(TICK_SOUNDS)

        async def _write(session):
            existing = await session.execute(select(User).where(User.name == name))
            if existing.scalar_one_or_none():
                return None
            user = User(name=name, password_hash=pw_hash, tick_sound=tick)
            session.add(user)
            await session.flush()
            await session.refresh(user)
            return user

        return await enqueue_write(_write)


def _build_provider() -> AuthProvider:
    """Instantiate the auth provider based on AUTH_PROVIDER env var.

    Currently only "local" (username/password with bcrypt) is implemented.
    Future providers (e.g. "oidc" for PocketID/LLDAP) can be added here.
    """
    if AUTH_PROVIDER == "local":
        return LocalProvider()
    raise ValueError(f"Unknown AUTH_PROVIDER: {AUTH_PROVIDER!r} (supported: local)")


auth_provider = _build_provider()


class AuthMiddleware:
    """Pure ASGI middleware — enforces JWT auth on all HTTP requests."""

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
        if guard.is_token_revoked(token):
            response = JSONResponse(
                {"error": "Token has been revoked"}, status_code=401
            )
            return await response(scope, receive, send)
        payload = decode_token(token)
        if not payload:
            response = JSONResponse(
                {"error": "Invalid or expired token"}, status_code=401
            )
            return await response(scope, receive, send)

        scope.setdefault("state", {})["current_user"] = {
            "id": payload["sub"], "name": payload["name"],
        }
        return await self.app(scope, receive, send)
