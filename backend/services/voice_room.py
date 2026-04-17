import logging

logger = logging.getLogger(__name__)


class VoiceRoom:
    def __init__(self):
        self._participants: set[str] = set()
        self._sharer: str | None = None

    @property
    def user_ids(self) -> set[str]:
        return set(self._participants)

    @property
    def sharer(self) -> str | None:
        return self._sharer

    def is_joined(self, user_id: str) -> bool:
        return user_id in self._participants

    def join(self, user_id: str) -> None:
        self._participants.add(user_id)
        logger.info(f"Voice joined: {user_id}, total: {len(self._participants)}")

    def leave(self, user_id: str) -> bool:
        if user_id not in self._participants:
            return False
        self._participants.discard(user_id)
        if self._sharer == user_id:
            self._sharer = None
        logger.info(f"Voice left: {user_id}, total: {len(self._participants)}")
        return True

    def start_sharing(self, user_id: str) -> bool:
        if self._sharer is not None:
            return False
        if not self.is_joined(user_id):
            return False
        self._sharer = user_id
        logger.info(f"Screenshare started by {user_id}")
        return True

    def stop_sharing(self, user_id: str) -> bool:
        if self._sharer != user_id:
            return False
        self._sharer = None
        logger.info(f"Screenshare stopped by {user_id}")
        return True


voice_room = VoiceRoom()
