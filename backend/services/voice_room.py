import logging

logger = logging.getLogger(__name__)


class VoiceRoom:
    """Tracks participants and the active screen-sharer in the single voice room.

    Each participant can hold at most one voice seat, associated with a
    specific ``connection_id`` (the WebSocket tab/device that joined voice).
    This enables multi-session support: a user can be connected via several
    browser tabs, but only one tab may be in voice at a time.

    This is a lightweight in-memory model — there is no persistence because
    voice state only matters while the server is running.
    """

    def __init__(self) -> None:
        self._participants: set[str] = set()
        self._muted: set[str] = set()
        self._speaking: set[str] = set()
        self._sharer: str | None = None
        self._sharer_connection_id: str | None = None
        self._voice_connection_ids: dict[str, str | None] = {}

    @property
    def user_ids(self) -> set[str]:
        return set(self._participants)

    @property
    def sharer(self) -> str | None:
        return self._sharer

    @property
    def sharer_connection_id(self) -> str | None:
        """The connection_id of the user currently sharing their screen, or ``None``."""
        return self._sharer_connection_id

    def is_joined(self, user_id: str) -> bool:
        return user_id in self._participants

    def is_muted(self, user_id: str) -> bool:
        return user_id in self._muted

    def is_speaking(self, user_id: str) -> bool:
        return user_id in self._speaking

    def voice_connection_id(self, user_id: str) -> str | None:
        """Return the connection_id that holds the voice seat for *user_id*.

        Returns ``None`` if the user is not in voice, or if they joined via
        a legacy client that did not supply a ``connection_id``.
        """
        return self._voice_connection_ids.get(user_id)

    def set_mute(self, user_id: str, muted: bool) -> None:
        if not self.is_joined(user_id):
            return
        if muted:
            self._muted.add(user_id)
        else:
            self._muted.discard(user_id)

    def set_speaking(self, user_id: str, speaking: bool) -> None:
        if not self.is_joined(user_id):
            return
        if speaking:
            self._speaking.add(user_id)
        else:
            self._speaking.discard(user_id)

    def join(self, user_id: str, connection_id: str | None = None) -> None:
        """Add a user to the voice room.

        Args:
            user_id: The user joining voice.
            connection_id: The specific WebSocket connection that is joining.
                ``None`` for legacy clients that do not supply one.
        """
        self._participants.add(user_id)
        self._voice_connection_ids[user_id] = connection_id
        self._muted.discard(user_id)
        self._speaking.discard(user_id)
        logger.info(
            "Voice joined: user=%s conn=%s total=%d",
            user_id,
            connection_id,
            len(self._participants),
        )

    def leave(self, user_id: str) -> bool:
        """Remove a user from the voice room entirely.

        Returns ``True`` if the user was actually in voice, ``False`` otherwise.
        """
        if user_id not in self._participants:
            logger.debug("Voice leave skipped (not joined): user=%s", user_id)
            return False
        self._participants.discard(user_id)
        self._muted.discard(user_id)
        self._speaking.discard(user_id)
        self._voice_connection_ids.pop(user_id, None)
        if self._sharer == user_id:
            self._sharer = None
            self._sharer_connection_id = None
        logger.info(
            "Voice left: user=%s total=%d", user_id, len(self._participants)
        )
        return True

    def start_sharing(
        self, user_id: str, connection_id: str | None = None
    ) -> bool:
        """Begin screen-sharing for *user_id*.

        Only the connection that currently holds the voice seat may start
        sharing.  Returns ``True`` on success.
        """
        if self._sharer is not None:
            logger.debug(
                "Screenshare start denied for user=%s: user=%s already sharing",
                user_id,
                self._sharer,
            )
            return False
        if not self.is_joined(user_id):
            logger.debug(
                "Screenshare start denied for user=%s: not in voice room", user_id
            )
            return False
        voice_conn = self._voice_connection_ids.get(user_id)
        if voice_conn is not None and connection_id != voice_conn:
            logger.debug(
                "Screenshare start denied for user=%s: conn=%s does not hold voice seat (voice_conn=%s)",
                user_id,
                connection_id,
                voice_conn,
            )
            return False
        self._sharer = user_id
        self._sharer_connection_id = connection_id
        logger.info(
            "Screenshare started by user=%s conn=%s", user_id, connection_id
        )
        return True

    def stop_sharing(
        self, user_id: str, connection_id: str | None = None
    ) -> bool:
        """Stop screen-sharing.

        Only the connection that started sharing may stop it.  Returns
        ``True`` on success.
        """
        if self._sharer != user_id:
            logger.debug(
                "Screenshare stop denied for user=%s: not the sharer (sharer=%s)",
                user_id,
                self._sharer,
            )
            return False
        if (
            self._sharer_connection_id is not None
            and connection_id != self._sharer_connection_id
        ):
            logger.debug(
                "Screenshare stop denied for user=%s: conn=%s is not the sharing connection (sharer_conn=%s)",
                user_id,
                connection_id,
                self._sharer_connection_id,
            )
            return False
        self._sharer = None
        self._sharer_connection_id = None
        logger.info("Screenshare stopped by user=%s", user_id)
        return True


voice_room = VoiceRoom()
