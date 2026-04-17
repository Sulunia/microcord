import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from models.base import get_engine

logger = logging.getLogger(__name__)

_queue: asyncio.Queue | None = None
_task: asyncio.Task | None = None
_write_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_write_session_factory() -> async_sessionmaker[AsyncSession]:
    global _write_session_factory
    if _write_session_factory is None:
        _write_session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _write_session_factory


async def _writer_loop(queue: asyncio.Queue):
    factory = _get_write_session_factory()
    while True:
        op, future = await queue.get()
        try:
            async with factory() as session:
                async with session.begin():
                    result = await op(session)
                future.set_result(result)
        except Exception as exc:
            logger.exception("DB write failed")
            if not future.done():
                future.set_exception(exc)
        finally:
            queue.task_done()


def get_queue() -> asyncio.Queue:
    global _queue
    if _queue is None:
        _queue = asyncio.Queue()
    return _queue


def start_writer():
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_event_loop().create_task(_writer_loop(get_queue()))
    return _task


async def enqueue_write(op):
    """Submit a write operation (async callable taking a session) and await its result."""
    future = asyncio.get_event_loop().create_future()
    await get_queue().put((op, future))
    return await future
