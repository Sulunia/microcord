import logging

logger = logging.getLogger(__name__)


class VoiceRoom:
    """Tracks participants and the active screen-sharer in the single voice room.

    This is a lightweight in-memory model — there is no persistence because
    voice state only matters while the server is running.
    """

    def __init__(self):
        self._participants: set[str] = set()
        self._muted: set[str] = set()
        self._sharer: str | None = None

    @property
    def user_ids(self) -> set[str]:
        return set(self._participants)

    @property
    def sharer(self) -> str | None:
        return self._sharer

    def is_joined(self, user_id: str) -> bool:
        return user_id in self._participants

    def is_muted(self, user_id: str) -> bool:
        return user_id in self._muted

    def set_mute(self, user_id: str, muted: bool) -> None:
        if not self.is_joined(user_id):
            return
        if muted:
            self._muted.add(user_id)
        else:
            self._muted.discard(user_id)

    def join(self, user_id: str) -> None:
        self._participants.add(user_id)
        self._muted.discard(user_id)
        logger.info(f"Voice joined: {user_id}, total: {len(self._participants)}")

    def leave(self, user_id: str) -> bool:
        if user_id not in self._participants:
            logger.debug(f"Voice leave skipped (not joined): {user_id}")
            return False
        self._participants.discard(user_id)
        self._muted.discard(user_id)
        if self._sharer == user_id:
            self._sharer = None
        logger.info(f"Voice left: {user_id}, total: {len(self._participants)}")
        return True

    def start_sharing(self, user_id: str) -> bool:
        if self._sharer is not None:
            logger.debug(f"Screenshare start denied for {user_id}: {self._sharer} already sharing")
            return False
        if not self.is_joined(user_id):
            logger.debug(f"Screenshare start denied for {user_id}: not in voice room")
            return False
        self._sharer = user_id
        logger.info(f"Screenshare started by {user_id}")
        return True

    def stop_sharing(self, user_id: str) -> bool:
        if self._sharer != user_id:
            logger.debug(f"Screenshare stop denied for {user_id}: not the sharer (sharer={self._sharer})")
            return False
        self._sharer = None
        logger.info(f"Screenshare stopped by {user_id}")
        return True


voice_room = VoiceRoom()
