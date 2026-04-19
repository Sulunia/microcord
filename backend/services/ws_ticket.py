import logging
import secrets
import time

logger = logging.getLogger(__name__)

_TICKET_TTL_SECONDS = 30
_tickets: dict[str, tuple[str, float]] = {}


def create_ticket(user_id: str) -> str:
    _evict_expired()
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = (user_id, time.monotonic() + _TICKET_TTL_SECONDS)
    logger.debug(f"Created WS ticket for user={user_id} (active tickets: {len(_tickets)})")
    return ticket


def redeem_ticket(ticket: str) -> str | None:
    entry = _tickets.pop(ticket, None)
    if entry is None:
        logger.debug("WS ticket redemption failed: ticket not found")
        return None
    user_id, expires_at = entry
    if time.monotonic() > expires_at:
        logger.debug(f"WS ticket redemption failed: expired for user={user_id}")
        return None
    logger.debug(f"WS ticket redeemed for user={user_id}")
    return user_id


def _evict_expired():
    now = time.monotonic()
    expired = [k for k, (_, exp) in _tickets.items() if now > exp]
    for k in expired:
        del _tickets[k]
    if expired:
        logger.debug(f"Evicted {len(expired)} expired WS tickets")
