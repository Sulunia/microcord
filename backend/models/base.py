import asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event, text
from sqlalchemy.schema import CreateIndex
from constants import DB_URL


class Base(DeclarativeBase):
    pass


_engine = None
_read_session_factory = None
_init_lock = asyncio.Lock()


def _enable_wal(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(DB_URL, echo=False)
        event.listen(_engine.sync_engine, "connect", _enable_wal)
    return _engine


def get_read_session() -> async_sessionmaker[AsyncSession]:
    global _read_session_factory
    if _read_session_factory is None:
        _read_session_factory = async_sessionmaker(get_engine(), expire_on_commit=False)
    return _read_session_factory


async def _migrate_columns(conn):
    """Add any missing columns to existing tables (SQLite ALTER TABLE)."""
    for table in Base.metadata.sorted_tables:
        result = await conn.execute(text(f"PRAGMA table_info({table.name})"))
        existing = {row[1] for row in result.fetchall()}
        for col in table.columns:
            if col.name not in existing:
                col_type = col.type.compile(dialect=conn.dialect)
                nullable = "" if col.nullable else " NOT NULL"
                default = ""
                if col.server_default is not None:
                    default = f" DEFAULT {col.server_default.arg}"
                await conn.execute(
                    text(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}{nullable}{default}")
                )


async def _migrate_indexes(conn):
    """Create any missing indexes defined in table_args."""
    for table in Base.metadata.sorted_tables:
        result = await conn.execute(text(f"PRAGMA index_list({table.name})"))
        existing = {row[1] for row in result.fetchall()}
        for idx in table.indexes:
            if idx.name not in existing:
                await conn.execute(CreateIndex(idx))


async def init_db():
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _migrate_columns(conn)
        await _migrate_indexes(conn)
