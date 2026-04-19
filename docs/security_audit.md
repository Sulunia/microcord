 # Security Audit — Microcord v0.3.0
 ## Summary
 The codebase has good security fundamentals (JWT pinning, DOMPurify, bcrypt, IDOR protection, identity-from-JWT), but there are several issues — from denial-of-service vectors to deployment hardening gaps — that should be addressed before production.
 Findings are ordered by severity.
 ---
 ## CRITICAL — Fix before deploying to prod
 ### C1. No rate limiting anywhere
 There is zero rate limiting on any endpoint. This leaves the app wide open to:
 - *Brute-force login* — an attacker can try passwords against /api/auth/login at unlimited speed 
 - *Registration spam* — unlimited account creation via /api/auth/register 
 - *Upload flooding* — unlimited 100 MB uploads to exhaust disk 
 - *Message spam* — unlimited POST /api/messages 
 - *WebSocket abuse* — unlimited reconnections
 *Recommendation:* Add rate limiting middleware (e.g. slowapi or a custom Starlette middleware). At minimum: 5 login attempts/minute per IP, 3 registrations/hour per IP, upload throttling per user.
 ---
 ### C2. Upload reads entire file into memory before size check
 42:76:backend/api/upload.py 
 async def upload_file(file) -> ConnexionResponse: 
 if not file or not file.filename: 
 return ConnexionResponse(status_code=400, body={"error": "No file provided"})
 ext = os.path.splitext(file.filename)[1].lower() 
 if ext not in ALLOWED_EXTENSIONS: 
 return ConnexionResponse(status_code=400, body={"error": f"Invalid file type: {ext}"})
 contents = await _read_file(file) 
 if len(contents) > MAX_UPLOAD_SIZE_BYTES: 
 return ConnexionResponse(status_code=413, body={"error": "File too large"}) 
 
 The entire file (up to unbounded size — the 100 MB check happens after read()) is loaded into memory. An attacker sending multiple concurrent large uploads can OOM the server. The same pattern applies to upload_avatar.
 *Recommendation:* Stream-read in chunks and abort as soon as the cumulative size exceeds the limit. Also enforce Content-Length header validation before reading.
 ---
 ### C3. Docker containers run as root
 Neither Dockerfile creates a non-root user:
 1:6:backend/Dockerfile 
 FROM python:3.12-slim 
 WORKDIR /app 
 COPY requirements.txt . 
 RUN pip install --no-cache-dir -r requirements.txt 
 EXPOSE 8000 
 CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--reload"] 
 
 1:15:Dockerfile.prod 
 FROM node:22-alpine AS frontend 
 // ... 
 FROM python:3.12-slim 
 WORKDIR /app 
 // ... 
 CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"] 
 
 If the application is compromised, the attacker has root in the container.
 *Recommendation:* Add RUN useradd -m appuser && chown -R appuser /app and USER appuser in both Dockerfiles.
 ---
 ### C4. Swagger UI exposed in production
 The repo-guide confirms Swagger UI is available at /api/ui/ in production, and it's auth-exempt:
 21:26:backend/services/auth.py 
 AUTH_EXEMPT_PREFIXES = ( 
 "/api/auth/", 
 "/api/ui", 
 "/api/openapi", 
 "/uploads/", 
 ) 
 
 This gives attackers a fully interactive map of every endpoint, parameter, and schema.
 *Recommendation:* Disable Swagger UI in production. Either gate it behind an env var, or add it to the auth-required paths and restrict to admin users.
 ---
 ### C5. JWT secret file written with default permissions
 46:48:backend/services/auth.py 
 secret = secrets.token_urlsafe(48) 
 secret_path.parent.mkdir(parents=True, exist_ok=True) 
 secret_path.write_text(secret) 
 
 The .jwt_secret file is written without setting restrictive permissions. On shared systems or misconfigured volumes, other processes or users could read it. Anyone with the secret can forge tokens for any user.
 *Recommendation:* Set permissions to 0o600 after writing: secret_path.chmod(0o600).
 ---
 ### C6. No TLS and no security headers
 The production container serves plain HTTP. There are no security headers set anywhere:
 - No Strict-Transport-Security 
 - No X-Content-Type-Options: nosniff 
 - No X-Frame-Options: DENY 
 - No Content-Security-Policy
 *Recommendation:* Add a security headers middleware. Document that a TLS-terminating reverse proxy (nginx, Caddy, Traefik) is required for production. Ideally, add a check that refuses to start without HTTPS config or an explicit INSECURE_HTTP=1 override.
 ---
 ## HIGH — Should fix before prod
 ### ~~H1. JWT exposed in WebSocket query string~~ — FIXED
JWT is no longer sent as a WebSocket query parameter. A one-time-use, 30-second TTL ticket system (`POST /api/auth/ws-ticket`) is used instead. The ticket is consumed on first WebSocket handshake and cannot be reused.
 52:52:frontend/src/hooks/use-chat.js 
 const ws = new WebSocket(`${WS_URL}?token=${token}`); 
 
 The JWT is passed as a URL query parameter. This means:
 - It appears in server access logs, reverse proxy logs, and CDN logs 
 - It may be cached by intermediary proxies 
 - It's visible in browser developer tools network tab to shoulder-surfers
 *Recommendation:* Use a short-lived, one-time-use ticket: client requests a ticket from a REST endpoint, then passes the ticket as the WS query param. The ticket is invalidated after first use and expires in ~30 seconds.
 ---
 ### H2. No token revocation / server-side logout
 87:91:frontend/src/hooks/use-user.js 
 const logout = useCallback(() => { 
 localStorage.removeItem(USER_STORAGE_KEY); 
 localStorage.removeItem(TOKEN_STORAGE_KEY); 
 setUser(null); 
 }, []); 
 
 Logout only clears localStorage. A stolen JWT remains valid until its exp claim (default 24 hours). There's no server-side blocklist.
 *Recommendation:* Implement a token blocklist (in-memory set or Redis) checked on each request, or reduce JWT_EXPIRY_HOURS significantly and use refresh tokens.
 ---
 ### H3. No per-user upload quotas — disk exhaustion
 With a 100 MB per-upload limit, no per-user quota, and no rate limiting, a single authenticated user can fill the server disk by repeatedly uploading 100 MB files.
 *Recommendation:* Add per-user storage quotas and/or daily upload limits. Consider lowering MAX_UPLOAD_SIZE_BYTES to something more reasonable like 10 MB for a chat app.
 ---
 ### H4. WebSocket messages have no size limit
 33:45:backend/ws/handler.py 
 try: 
 while True: 
 message = await websocket.receive() 
 // ... 
 raw = message.get("text") 
 // ... 
 msg = json.loads(raw) 
 
 There's no limit on the size of incoming WebSocket messages. An attacker could send a multi-gigabyte JSON string to exhaust server memory.
 *Recommendation:* Configure a max WebSocket message size. Starlette/uvicorn supports --ws-max-size (default is 16 MB which is already too generous for signaling messages — set it to something like 64 KB).
 ---
 ### H5. Dependencies are unpinned
 1:6:backend/requirements.txt 
 connexion[flask,uvicorn,swagger-ui]>=3.1 
 sqlalchemy[asyncio]>=2.0 
 aiosqlite>=0.20 
 python-multipart>=0.0.9 
 pyjwt[crypto]>=2.8 
 bcrypt>=4.0 
 
 Using >= constraints means every build may pull different versions. A supply-chain attack or broken release of any dependency would silently affect production builds.
 *Recommendation:* Pin exact versions with hashes (pip freeze > requirements.txt or use pip-compile with --generate-hashes).
 ---
 ### H6. WEBP magic byte validation is incomplete
 19:24:backend/api/upload.py 
 MAGIC_BYTES = { 
 b"\x89PNG": {".png"}, 
 b"\xff\xd8\xff": {".jpg", ".jpeg"}, 
 b"GIF8": {".gif"}, 
 b"RIFF": {".webp"}, 
 } 
 
 WEBP files start with RIFF....WEBP, but the check only verifies the first 4 bytes (RIFF). This also matches WAV, AVI, and other RIFF-based formats. An attacker could upload arbitrary RIFF files (like audio) disguised as .webp.
 *Recommendation:* Check for the full signature: contents[:4] == b"RIFF" and contents[8:12] == b"WEBP".
 ---
 ## MEDIUM — Address shortly after launch
 ### M1. Screenshare signal relay has no authorization check
 102:110:backend/ws/handler.py 
 async def _handle_screenshare_signal(user_id: str, data: dict): 
 target = data.get("target") 
 signal = data.get("signal") 
 if not target or not signal: 
 return 
 await ws_manager.send_to(target, { 
 "type": "screenshare_signal", 
 "data": {"from": user_id, "signal": signal}, 
 }) 
 
 Any authenticated user can send WebRTC signaling messages to any other connected user, even if neither is in the voice channel. Compare with _handle_voice_signal which correctly checks voice_room.is_joined() for both parties. The _handle_screenshare_request has the same issue.
 *Recommendation:* Add voice_room.is_joined(user_id) and voice_room.is_joined(target) checks to _handle_screenshare_signal, similar to the voice signal handler.
 ---
 ### M2. JWT stored in localStorage — XSS escalation vector
 Token and user data are stored in localStorage, which is accessible to any JavaScript running on the page. If an XSS vulnerability is found (despite DOMPurify), the attacker gets full account takeover. HttpOnly cookies are immune to this.
 *Recommendation:* Consider migrating to HttpOnly + SameSite=Strict + Secure cookies for token storage.
 ---
 ### M3. No content-length validation on message content
 The SendMessageRequest schema has no maxLength constraint on content:
 384:394:backend/openapi/spec.yaml 
 SendMessageRequest: 
 type: object 
 required: 
 - content 
 properties: 
 content: 
 type: string 
 image_url: 
 type: string 
 nullable: true 
 
 A user could send a multi-megabyte chat message that gets stored in the DB and broadcast to all connected clients.
 *Recommendation:* Add maxLength: 4000 (or similar) to the content field in the OpenAPI spec.
 ---
 ### M4. User enumeration via /api/users
 21:25:backend/api/users.py 
 async def list_users() -> list[dict]: 
 factory = get_read_session() 
 async with factory() as session: 
 result = await session.execute(select(User).order_by(User.created_at)) 
 return [u.to_dict() for u in result.scalars().all()] 
 
 Any authenticated user can list all registered users. For a small self-hosted app this may be intentional, but it's worth noting that it leaks the full user directory.
 ---
 ### M5. Registration has minimal password requirements
 16:17:backend/api/auth.py 
 if len(password) < 6: 
 return ConnexionResponse(status_code=400, body={"error": "Password must be at least 6 characters"}) 
 
 A 6-character minimum with no complexity requirements allows very weak passwords (e.g. aaaaaa).
 *Recommendation:* Consider adding basic complexity checks or a minimum length of 8+.
 ---
 ## LOW / Informational
 | # | Finding | Notes | 
 |---|---------|-------| 
 | L1 | No audit logging | Security-relevant events (login failures, permission denials, uploads) are logged at INFO but there's no structured audit trail | 
 | L2 | No account lockout | Unlimited login attempts per account (compounded by C1) | 
 | L3 | image_url accepts any path under /uploads/ | While path traversal is neutralized by browser path normalization and this is only used as an <img src>, validating the exact UUID format would be more robust | 
 | L4 | No CSRF explicit protection | Mitigated by bearer tokens in Authorization headers, which browsers don't auto-attach. Acceptable. | 
 | L5 | Connexion OpenAPI spec served unauthenticated | /api/openapi is auth-exempt, exposing the full spec as JSON (separate from Swagger UI) | 
 | L6 | Single SQLite instance | Fine for small self-hosted use, but no replication or backup strategy documented |
 ---
 ## What's already done well
 Credit where it's due — the codebase already handles several common pitfalls correctly:
 - *JWT algorithm pinning* — only HS256 accepted, none algorithm rejected 
 - *JWT claim validation* — issuer, audience, expiry, and required claims all enforced 
 - *Identity from JWT* — author IDs never taken from request bodies 
 - *IDOR protection* — PATCH /users/{id} verifies JWT user matches path user 
 - *XSS prevention* — snarkdown output sanitized through DOMPurify 
 - *Password hashing* — bcrypt with auto-generated salt 
 - *Upload filename sanitization* — UUIDs instead of user-provided names 
 - *Magic byte validation* — file content checked, not just extension 
 - *Single-writer SQLite queue* — prevents concurrent write corruption 
 - *password_hash excluded from API responses* — User.to_dict() correctly omits it 
 - *CORS* — locked to a single specific origin
 ---
 ## Recommended priority for prod readiness
 1. *C3* (non-root Docker) — 5 min fix 
 2. *C5* (JWT secret permissions) — 1 line fix 
 3. *H6* (WEBP magic bytes) — 2 line fix 
 4. *M1* (screenshare auth check) — 5 min fix 
 5. *C4* (disable Swagger UI in prod) — quick config change 
 6. *C6* (security headers) — add a small middleware 
 7. *C2* (streaming upload reads) — moderate refactor 
 8. *C1* (rate limiting) — add middleware + tuning 
 9. *H5* (pin dependencies) — pip freeze and review 
 10. *H4* (WS message size limit) — uvicorn flag 
 11. Everything else as time allows