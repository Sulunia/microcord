import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, Boolean, Integer
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base

TICK_SOUNDS = [1, 2, 3, 4]


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    tick_sound: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    @property
    def effective_name(self) -> str:
        return self.display_name or self.name

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "display_name": self.effective_name,
            "avatar_url": self.avatar_url,
            "tick_sound": self.tick_sound,
            "created_at": self.created_at.isoformat() + ("Z" if not self.created_at.tzinfo else ""),
        }
