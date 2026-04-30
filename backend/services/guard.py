import logging
import os
import secrets
import time

from constants import TRUST_PROXY, TRUSTED_PROXY_HOPS

logger = logging.getLogger(__name__)


def get_client_ip(scope: dict) -> str:
    if TRUST_PROXY:
        headers = {
            k.decode().lower(): v.decode()
            for k, v in scope.get("headers", [])
        }
        xri = headers.get("x-real-ip", "")
        if xri:
            return xri.strip()
        xff = headers.get("x-forwarded-for", "")
        if xff:
            parts = [p.strip() for p in xff.split(",")]
            idx = len(parts) - TRUSTED_PROXY_HOPS
            return parts[idx] if 0 <= idx < len(parts) else parts[0]
    client = scope.get("client")
    return client[0] if client else "unknown"


class Guard:
    """Rate-limiting, token-revocation, and registration-passphrase guard.

    Maintains in-memory buckets for exponential-backoff rate limiting
    and a lightweight JTI revocation store.  A periodic prune sweeps
    stale entries to keep memory bounded.
    """

    _PRUNE_INTERVAL = 200

    def __init__(self):
        self._buckets: dict[str, list] = {}
        self._revoked: dict[str, float] = {}
        self._check_count: int = 0

        passphrase = os.environ.get("REGISTRATION_PASSPHRASE", "")
        self.passphrase = passphrase.strip().upper() if passphrase else secrets.token_hex(3).upper()

    def log_passphrase(self) -> None:
        logger.info(f"Registration passphrase: {self.passphrase}")

    def revoke_jti(self, jti: str, expires_at: float) -> None:
        self._revoked[jti] = expires_at
        logger.debug(f"Revoked JTI {jti[:8]}… until {expires_at:.0f}")

    def is_jti_revoked(self, jti: str) -> bool:
        exp = self._revoked.get(jti)
        if exp is None:
            return False
        if exp < time.time():
            del self._revoked[jti]
            return False
        return True

    def check(self, key: str, max_hits: int, window: float, max_backoff: float) -> float | None:
        now = time.time()
        bucket = self._buckets.get(key)

        if bucket is None:
            bucket = [0, now, 0.0]
            self._buckets[key] = bucket

        if bucket[2] > now:
            remaining = bucket[2] - now
            logger.debug(f"Rate-limited {key}: {remaining:.1f}s backoff remaining")
            return remaining

        if now - bucket[1] >= window:
            bucket[0] = 0
            bucket[1] = now

        bucket[0] += 1

        if bucket[0] > max_hits:
            violations = bucket[0] - max_hits
            backoff = min(2 ** violations, max_backoff)
            bucket[2] = now + backoff
            logger.info(f"Rate limit exceeded for {key}: {violations} violations, {backoff:.0f}s backoff")
            self._maybe_prune()
            return backoff

        self._maybe_prune()
        return None

    def check_register(self, ip: str) -> float | None:
        return self.check(f"rl:reg:{ip}", max_hits=3, window=3600, max_backoff=3600)

    def check_login(self, ip: str) -> float | None:
        return self.check(f"rl:login:{ip}", max_hits=5, window=60, max_backoff=300)

    def check_message(self, user_id: str) -> float | None:
        return self.check(f"rl:msg:{user_id}", max_hits=10, window=10, max_backoff=60)

    def check_upload(self, user_id: str) -> float | None:
        return self.check(f"rl:upload:{user_id}", max_hits=5, window=60, max_backoff=120)

    def check_refresh(self, user_id: str) -> float | None:
        return self.check(f"rl:refresh:{user_id}", max_hits=10, window=60, max_backoff=120)

    def verify_passphrase(self, provided: str) -> bool:
        if not provided:
            return False
        result = secrets.compare_digest(provided.strip().upper(), self.passphrase)
        if not result:
            logger.debug("Passphrase verification failed")
        return result

    def _maybe_prune(self) -> None:
        self._check_count += 1
        if self._check_count % self._PRUNE_INTERVAL == 0:
            self._prune()

    def _prune(self) -> None:
        now = time.time()
        expired = [t for t, exp in self._revoked.items() if exp < now]
        for t in expired:
            del self._revoked[t]
        stale = [k for k, b in self._buckets.items()
                 if b[2] <= now and now - b[1] > 600]
        for k in stale:
            del self._buckets[k]
        if expired or stale:
            logger.debug(f"Pruned {len(expired)} revoked JTIs, {len(stale)} stale rate-limit buckets")


guard = Guard()
