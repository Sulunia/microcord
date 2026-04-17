import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from models.base import Base


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_created_at_id", "created_at", "id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    author = relationship("User", lazy="joined")

    def to_dict(self, include_author=False):
        d = {
            "id": self.id,
            "author_id": self.author_id,
            "content": self.content,
            "image_url": self.image_url,
            "created_at": self.created_at.isoformat() + ("Z" if not self.created_at.tzinfo else ""),
        }
        if include_author and self.author:
            d["author"] = self.author.to_dict()
        return d
