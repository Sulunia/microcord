import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, or_, and_
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from constants import DB_URL
from database.models import (
    Base, User, Message, RefreshToken,
    _enable_wal, _migrate_columns, _migrate_indexes,
)

logger = logging.getLogger(__name__)


class BackendRepository:
    """Central data-access layer for the microcord backend.

    Owns the SQLAlchemy async engine, session factory, and a serialized
    write queue.  All reads go through independent sessions; all writes
    are funnelled through a single ``asyncio.Queue`` so that only one
    write transaction is in flight at a time (required for SQLite).

    Call :meth:`init` at startup to create tables and run lightweight
    column/index migrations, then :meth:`start_writer` to spin up the
    background writer task.
    """

    def __init__(self, db_url: str):
        self._engine = create_async_engine(db_url, echo=False)
        event.listen(self._engine.sync_engine, "connect", _enable_wal)
        self._session_factory = async_sessionmaker(self._engine, expire_on_commit=False)
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None

    async def init(self):
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await _migrate_columns(conn)
            await _migrate_indexes(conn)

    def start_writer(self):
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._task is None or self._task.done():
            self._task = asyncio.get_event_loop().create_task(self._writer_loop())
        return self._task

    async def _writer_loop(self):
        while True:
            op, future = await self._queue.get()
            try:
                async with self._session_factory() as session:
                    async with session.begin():
                        result = await op(session)
                    future.set_result(result)
            except Exception as exc:
                logger.exception("DB write failed")
                if not future.done():
                    future.set_exception(exc)
            finally:
                self._queue.task_done()

    async def _enqueue_write(self, op):
        future = asyncio.get_event_loop().create_future()
        await self._queue.put((op, future))
        return await future

    # ── Reads ──────────────────────────────────────────────────────────

    async def get_user_by_id(self, user_id: str) -> User | None:
        async with self._session_factory() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            return result.scalar_one_or_none()

    async def get_user_by_name(self, name: str) -> User | None:
        async with self._session_factory() as session:
            result = await session.execute(select(User).where(User.name == name))
            return result.scalar_one_or_none()

    async def list_users(self) -> list[User]:
        async with self._session_factory() as session:
            result = await session.execute(select(User).order_by(User.created_at))
            return list(result.scalars().all())

    async def get_users_by_ids(self, ids: set[str]) -> dict[str, User]:
        if not ids:
            return {}
        async with self._session_factory() as session:
            result = await session.execute(select(User).where(User.id.in_(ids)))
            return {u.id: u for u in result.scalars().all()}

    async def list_messages(
        self,
        limit: int,
        cursor_ts=None,
        cursor_id=None,
    ) -> tuple[list[Message], bool]:
        async with self._session_factory() as session:
            query = (
                select(Message)
                .order_by(Message.created_at.desc(), Message.id.desc())
            )
            if cursor_ts is not None and cursor_id is not None:
                query = query.where(
                    or_(
                        Message.created_at < cursor_ts,
                        and_(Message.created_at == cursor_ts, Message.id < cursor_id),
                    )
                )
            query = query.limit(limit + 1)
            result = await session.execute(query)
            rows = list(result.scalars().all())
            has_next = len(rows) > limit
            if has_next:
                rows = rows[:limit]
            return rows, has_next

    # ── Writes ─────────────────────────────────────────────────────────

    async def create_user(self, name: str, password_hash: str, tick_sound: int) -> User | None:
        async def _write(session):
            existing = await session.execute(select(User).where(User.name == name))
            if existing.scalar_one_or_none():
                return None
            user = User(name=name, password_hash=password_hash, tick_sound=tick_sound)
            session.add(user)
            await session.flush()
            await session.refresh(user)
            return user

        return await self._enqueue_write(_write)

    async def update_user_profile(
        self,
        user_id: str,
        display_name: str | None = None,
        tick_sound: int | None = None,
    ) -> User | None:
        async def _write(session):
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user:
                return None
            if display_name is not None:
                user.display_name = display_name
            if tick_sound is not None:
                user.tick_sound = tick_sound
            await session.flush()
            await session.refresh(user)
            return user

        return await self._enqueue_write(_write)

    async def update_user_avatar(self, user_id: str, avatar_url: str) -> User | None:
        async def _write(session):
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if not user:
                return None
            user.avatar_url = avatar_url
            await session.flush()
            await session.refresh(user)
            return user

        return await self._enqueue_write(_write)

    async def create_message(
        self,
        author_id: str,
        content: str,
        image_url: str | None,
    ) -> Message:
        async def _write(session):
            msg = Message(author_id=author_id, content=content, image_url=image_url)
            session.add(msg)
            await session.flush()
            await session.refresh(msg, attribute_names=["author"])
            return msg

        return await self._enqueue_write(_write)

    async def delete_message(self, message_id: str, author_id: str) -> Message | None:
        async def _write(session):
            result = await session.execute(select(Message).where(Message.id == message_id))
            msg = result.scalar_one_or_none()
            if not msg:
                return None
            if msg.author_id != author_id:
                return None
            await session.delete(msg)
            return msg

        return await self._enqueue_write(_write)

    async def update_message_image(self, message_id: str, image_url: str) -> Message | None:
        async def _write(session):
            result = await session.execute(select(Message).where(Message.id == message_id))
            msg = result.scalar_one_or_none()
            if not msg:
                return None
            msg.image_url = image_url
            await session.flush()
            await session.refresh(msg, attribute_names=["author"])
            return msg

        return await self._enqueue_write(_write)

    async def store_refresh_token(self, user_id: str, token_hash: str, expires_at) -> RefreshToken:
        async def _write(session):
            rt = RefreshToken(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
            session.add(rt)
            await session.flush()
            await session.refresh(rt)
            return rt

        return await self._enqueue_write(_write)

    async def get_refresh_token_by_hash(self, token_hash: str) -> RefreshToken | None:
        async with self._session_factory() as session:
            result = await session.execute(
                select(RefreshToken).where(RefreshToken.token_hash == token_hash)
            )
            return result.scalar_one_or_none()

    async def consume_refresh_token(self, token_id: str) -> None:
        async def _write(session):
            result = await session.execute(
                select(RefreshToken).where(RefreshToken.id == token_id)
            )
            rt = result.scalar_one_or_none()
            if rt:
                rt.consumed = True
        return await self._enqueue_write(_write)

    async def revoke_refresh_token(self, token_id: str) -> None:
        async def _write(session):
            result = await session.execute(
                select(RefreshToken).where(RefreshToken.id == token_id)
            )
            rt = result.scalar_one_or_none()
            if rt:
                rt.revoked_at = datetime.now(timezone.utc)
        return await self._enqueue_write(_write)

    async def revoke_all_refresh_tokens_for_user(self, user_id: str) -> None:
        async def _write(session):
            now = datetime.now(timezone.utc)
            result = await session.execute(
                select(RefreshToken).where(
                    RefreshToken.user_id == user_id,
                    RefreshToken.revoked_at.is_(None),
                )
            )
            for rt in result.scalars().all():
                rt.revoked_at = now
        return await self._enqueue_write(_write)

    async def prune_expired_refresh_tokens(self) -> int:
        async def _write(session):
            now = datetime.now(timezone.utc)
            result = await session.execute(
                select(RefreshToken).where(
                    RefreshToken.expires_at < now,
                    RefreshToken.revoked_at.isnot(None),
                )
            )
            rows = result.scalars().all()
            count = len(rows)
            for rt in rows:
                await session.delete(rt)
            return count
        return await self._enqueue_write(_write)


repo = BackendRepository(DB_URL)
