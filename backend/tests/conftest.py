"""Shared test fixtures for Microcord backend tests.

Provides an isolated SQLite database per test with seeded data
(owner, members, default channel) and a managed event loop for
async operations.

NOTE: All fixtures are synchronous so they work with pytest-bdd's
generated sync test functions. The event loop is managed explicitly
via the ``async_loop`` fixture.
"""

import asyncio
import hashlib
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, AsyncMock

import pytest

# ── Bootstrap: set env vars BEFORE importing app code ────────────
os.environ.setdefault("JWT_SECRET", "test-secret-that-is-at-least-32-characters-long!!")
os.environ.setdefault("CORS_ORIGIN", "http://localhost:5173")
os.environ.setdefault("REGISTRATION_PASSPHRASE", "TESTPHRASE")
os.environ.setdefault("AUTH_PROVIDER", "local")
os.environ.setdefault("INSECURE_HTTP", "true")

# Make sure backend/ is importable
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from database.models import Base, User, Channel
from database.repository import BackendRepository


# ── Seed data constants ──────────────────────────────────────────
OWNER_NAME = "owner_user"
OWNER_PASSWORD = "owner_pass_123"
OWNER_ID = "aaaaaaaa-0000-0000-0000-000000000001"

MEMBER_NAME = "member_alice"
MEMBER_PASSWORD = "alice_pass_456"
MEMBER_ID = "bbbbbbbb-0000-0000-0000-000000000002"

SECOND_MEMBER_NAME = "member_bob"
SECOND_MEMBER_PASSWORD = "bob_pass_789"
SECOND_MEMBER_ID = "cccccccc-0000-0000-0000-000000000003"

DEFAULT_CHANNEL_ID = "dddddddd-0000-0000-0000-000000000004"

VALID_RECOVERY_PASSPHRASE = "abc123XYZ"
VALID_RECOVERY_HASH = hashlib.sha256(VALID_RECOVERY_PASSPHRASE.encode()).hexdigest()

EXPIRED_RECOVERY_PASSPHRASE = "expired99AA"
EXPIRED_RECOVERY_HASH = hashlib.sha256(EXPIRED_RECOVERY_PASSPHRASE.encode()).hexdigest()


def _hash_password(password: str) -> str:
    """Hash a password with bcrypt for seeding."""
    import bcrypt
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


# ── FakeConnectionManager ────────────────────────────────────────

class FakeConnectionManager:
    """Drop-in replacement for ConnectionManager that records calls.

    No real WebSocket connections — all public methods are async no-ops
    that record their arguments for later assertion.
    """

    def __init__(self) -> None:
        self.broadcasts: list[dict] = []
        self.sent_messages: list[dict] = []
        self.connections: dict[str, dict] = {}

    # ── Broadcast ────────────────────────────────────────────────

    async def broadcast(
        self,
        message: dict,
        exclude_user: str | None = None,
        exclude_connection: tuple[str, str] | None = None,
    ) -> None:
        self.broadcasts.append({
            "message": message,
            "exclude_user": exclude_user,
            "exclude_connection": exclude_connection,
        })

    # ── Send ─────────────────────────────────────────────────────

    async def send_to(self, user_id: str, message: dict) -> None:
        self.sent_messages.append({"user_id": user_id, "message": message})

    async def send_to_connection(
        self, user_id: str, connection_id: str, message: dict,
    ) -> None:
        self.sent_messages.append({
            "user_id": user_id,
            "connection_id": connection_id,
            "message": message,
        })

    # ── Connect / Disconnect (no-op, just track) ─────────────────

    async def connect(self, user_id: str, websocket=None) -> str:
        import secrets
        conn_id = secrets.token_urlsafe(16)
        if user_id not in self.connections:
            self.connections[user_id] = {}
        self.connections[user_id][conn_id] = True
        return conn_id

    def disconnect(self, user_id: str, connection_id: str) -> bool:
        user_conns = self.connections.get(user_id)
        if user_conns is None:
            return True
        user_conns.pop(connection_id, None)
        is_last = len(user_conns) == 0
        if is_last:
            del self.connections[user_id]
        return is_last

    # ── Inspect helpers ──────────────────────────────────────────

    @property
    def connected_user_ids(self) -> list[str]:
        return list(self.connections.keys())

    def is_connection_active(self, user_id: str, connection_id: str) -> bool:
        user_conns = self.connections.get(user_id)
        return user_conns is not None and connection_id in user_conns

    def get_connections(self, user_id: str) -> dict:
        return dict(self.connections.get(user_id, {}))

    @property
    def total_connections(self) -> int:
        return sum(len(conns) for conns in self.connections.values())

    # ── Test helpers ─────────────────────────────────────────────

    @property
    def last_broadcast(self) -> dict:
        """Return the most recent broadcast entry, or raise."""
        assert self.broadcasts, "No broadcasts recorded"
        return self.broadcasts[-1]

    def clear(self) -> None:
        """Reset all recorded calls."""
        self.broadcasts.clear()
        self.sent_messages.clear()


# ── Managed event loop ───────────────────────────────────────────

@pytest.fixture
def async_loop():
    """Provide a managed event loop for the test session.

    All async operations (repo, handlers) run on this loop so that
    aiosqlite connections stay valid across step function calls.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


# ── Patch fixtures ───────────────────────────────────────────────

@pytest.fixture
def patched_initiate_recovery(test_repo, fake_ws):
    """Context manager that applies all patches needed to call
    ``users_mod.recover_account()`` as owner (with WS side-effects).

    Usage::

        with patched_initiate_recovery(caller_id) as mocks:
            response = _run(loop, users_mod.recover_account(target_id))
    """
    from api import users as users_mod
    from services import auth as auth_mod

    @contextmanager
    def _patcher(caller_id: str):
        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "ws_manager", fake_ws), \
             patch.object(users_mod, "current_user_is_owner", return_value=True), \
             patch.object(users_mod, "current_user_id", return_value=caller_id), \
             patch.object(auth_mod, "repo", test_repo), \
             patch.object(users_mod, "revoke_all_refresh_tokens", new_callable=AsyncMock) as mock_revoke, \
             patch.object(users_mod, "guard") as mock_guard:

            yield {"revoke": mock_revoke, "guard": mock_guard}

    return _patcher


@pytest.fixture
def patched_auth_repo(test_repo):
    """Context manager that patches both ``api.auth.repo`` and
    ``services.auth.repo`` with the test repository.

    Usage::

        with patched_auth_repo():
            response = _run(loop, auth_mod._try_account_recovery(...))
    """
    from api import auth as auth_mod
    from services import auth as auth_svc

    @contextmanager
    def _patcher():
        with patch.object(auth_mod, "repo", test_repo), \
             patch.object(auth_svc, "repo", test_repo):
            yield

    return _patcher


@pytest.fixture
def patched_recover_basic(test_repo):
    """Context manager that applies minimal patches for calling
    ``users_mod.recover_account()`` without WS side-effects
    (non-owner / error paths that bail out early).

    Usage::

        with patched_recover_basic(caller_id, is_owner=False):
            response = _run(loop, users_mod.recover_account(target_id))
    """
    from api import users as users_mod

    @contextmanager
    def _patcher(caller_id: str, is_owner: bool = False):
        with patch.object(users_mod, "repo", test_repo), \
             patch.object(users_mod, "current_user_is_owner", return_value=is_owner), \
             patch.object(users_mod, "current_user_id", return_value=caller_id):
            yield

    return _patcher


# ── Database fixtures ────────────────────────────────────────────

@pytest.fixture
def test_repo(tmp_path, async_loop):
    """Provide a fresh BackendRepository backed by a temp SQLite file.

    The repository is fully initialized (tables created, writer started)
    and seeded with standard test users. All async setup/teardown runs
    on the managed ``async_loop``.
    """
    db_path = tmp_path / "test.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"

    repository = BackendRepository(db_url)
    async_loop.run_until_complete(repository.init())

    # ── Seed users ───────────────────────────────────────────────
    owner_hash = _hash_password(OWNER_PASSWORD)
    member_hash = _hash_password(MEMBER_PASSWORD)
    bob_hash = _hash_password(SECOND_MEMBER_PASSWORD)

    async def _seed_users(session):
        session.add(User(
            id=OWNER_ID, name=OWNER_NAME, password_hash=owner_hash,
            is_admin=True, is_owner=True, tick_sound=1,
            created_at=datetime.now(timezone.utc),
        ))
        session.add(User(
            id=MEMBER_ID, name=MEMBER_NAME, password_hash=member_hash,
            is_admin=False, is_owner=False, tick_sound=1,
            created_at=datetime.now(timezone.utc) + timedelta(seconds=1),
        ))
        session.add(User(
            id=SECOND_MEMBER_ID, name=SECOND_MEMBER_NAME, password_hash=bob_hash,
            is_admin=False, is_owner=False, tick_sound=2,
            created_at=datetime.now(timezone.utc) + timedelta(seconds=2),
        ))

    async_loop.run_until_complete(repository._enqueue_write(_seed_users))

    yield repository

    # ── Cleanup ──────────────────────────────────────────────────
    if repository._task and not repository._task.done():
        repository._task.cancel()
    async_loop.run_until_complete(repository._engine.dispose())


@pytest.fixture
def seeded_repo_with_pending_recovery(test_repo, async_loop):
    """Return a repo where MEMBER (alice) has a pending, non-expired recovery.

    Her password_hash is cleared (as set_recovery does) and the recovery
    passphrase is VALID_RECOVERY_PASSPHRASE.
    """
    expires_at = datetime.now(timezone.utc) + timedelta(days=2)

    async def _set_recovery(session):
        from sqlalchemy import select
        result = await session.execute(select(User).where(User.id == MEMBER_ID))
        user = result.scalar_one_or_none()
        if user:
            user.password_hash = None
            user.recovery_hash = VALID_RECOVERY_HASH
            user.recovery_expires_at = expires_at

    async_loop.run_until_complete(test_repo._enqueue_write(_set_recovery))
    return test_repo


@pytest.fixture
def seeded_repo_with_expired_recovery(test_repo, async_loop):
    """Return a repo where MEMBER (alice) has an EXPIRED recovery."""
    expired_at = datetime.now(timezone.utc) - timedelta(hours=1)

    async def _set_expired_recovery(session):
        from sqlalchemy import select
        result = await session.execute(select(User).where(User.id == MEMBER_ID))
        user = result.scalar_one_or_none()
        if user:
            user.password_hash = None
            user.recovery_hash = EXPIRED_RECOVERY_HASH
            user.recovery_expires_at = expired_at

    async_loop.run_until_complete(test_repo._enqueue_write(_set_expired_recovery))
    return test_repo


@pytest.fixture
def fake_ws():
    """Provide a FakeConnectionManager for tests that need WS assertions."""
    return FakeConnectionManager()
