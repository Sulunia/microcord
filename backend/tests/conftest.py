"""Shared test fixtures for Microcord backend tests.

Provides an isolated SQLite database per test with seeded data
(owner, members, default channel) and clean event-loop lifecycle.
"""

import hashlib
import os
import sys
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio

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


# ── Fixtures ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def test_repo(tmp_path):
    """Provide a fresh BackendRepository backed by a temp SQLite file.

    The repository is fully initialized (tables created, writer started,
    default channel migrated by init) and seeded with standard test users.
    """
    db_path = tmp_path / "test.db"
    db_url = f"sqlite+aiosqlite:///{db_path}"

    repository = BackendRepository(db_url)
    await repository.init()

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

    await repository._enqueue_write(_seed_users)

    yield repository

    # ── Cleanup ──────────────────────────────────────────────────
    # Cancel the writer task so it doesn't outlive the event loop
    if repository._task and not repository._task.done():
        repository._task.cancel()
    await repository._engine.dispose()


@pytest_asyncio.fixture
async def seeded_repo_with_pending_recovery(test_repo):
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

    await test_repo._enqueue_write(_set_recovery)
    return test_repo


@pytest_asyncio.fixture
async def seeded_repo_with_expired_recovery(test_repo):
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

    await test_repo._enqueue_write(_set_expired_recovery)
    return test_repo
