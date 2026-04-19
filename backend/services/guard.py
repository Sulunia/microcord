import logging
import os
import secrets
import time

from constants import TRUST_PROXY

logger = logging.getLogger(__name__)


def get_client_ip(scope: dict) -> str:
    if TRUST_PROXY:
        headers = {
            k.decode().lower(): v.decode()
            for k, v in scope.get("headers", [])
        }
        xff = headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
        xri = headers.get("x-real-ip", "")
        if xri:
            return xri.strip()
    client = scope.get("client")
    return client[0] if client else "unknown"


class Guard:
    _PRUNE_INTERVAL = 200

    def __init__(self):
        self._buckets: dict[str, list] = {}
        self._revoked: dict[str, float] = {}
        self._check_count: int = 0

        passphrase = os.environ.get("REGISTRATION_PASSPHRASE", "")
        self.passphrase = passphrase.strip().upper() if passphrase else secrets.token_hex(3).upper()

    def log_passphrase(self) -> None:
        logger.info(f"Registration passphrase: {self.passphrase}")

    # --- Token revocation (by JTI) ---

    def revoke_jti(self, jti: str, expires_at: float) -> None:
        self._revoked[jti] = expires_at

    def is_jti_revoked(self, jti: str) -> bool:
        exp = self._revoked.get(jti)
        if exp is None:
            return False
        if exp < time.time():
            del self._revoked[jti]
            return False
        return True

    @staticmethod
    def is_token_revoked(token: str) -> bool:
        import warnings
        warnings.warn("Use is_jti_revoked instead", DeprecationWarning, stacklevel=2)
        return False

    # --- Rate limiting with exponential backoff ---

    def check(self, key: str, max_hits: int, window: float, max_backoff: float) -> float | None:
        now = time.time()
        bucket = self._buckets.get(key)

        if bucket is None:
            bucket = [0, now, 0.0]
            self._buckets[key] = bucket

        if bucket[2] > now:
            return bucket[2] - now

        if now - bucket[1] >= window:
            bucket[0] = 0
            bucket[1] = now

        bucket[0] += 1

        if bucket[0] > max_hits:
            violations = bucket[0] - max_hits
            backoff = min(2 ** violations, max_backoff)
            bucket[2] = now + backoff
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

    def verify_passphrase(self, provided: str) -> bool:
        if not provided:
            return False
        return secrets.compare_digest(provided.strip().upper(), self.passphrase)

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


guard = Guard()
