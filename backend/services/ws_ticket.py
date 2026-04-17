import secrets
import time

_TICKET_TTL_SECONDS = 30
_tickets: dict[str, tuple[str, float]] = {}


def create_ticket(user_id: str) -> str:
    _evict_expired()
    ticket = secrets.token_urlsafe(32)
    _tickets[ticket] = (user_id, time.monotonic() + _TICKET_TTL_SECONDS)
    return ticket


def redeem_ticket(ticket: str) -> str | None:
    entry = _tickets.pop(ticket, None)
    if entry is None:
        return None
    user_id, expires_at = entry
    if time.monotonic() > expires_at:
        return None
    return user_id


def _evict_expired():
    now = time.monotonic()
    expired = [k for k, (_, exp) in _tickets.items() if now > exp]
    for k in expired:
        del _tickets[k]
