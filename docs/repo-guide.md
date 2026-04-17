# Microcord — Repo Guide

Minimal self-hosted Discord-like app with text chat, voice channels, screen sharing, and client-side media transcoding.
Version **0.3.1**.

---

## 1. High-Level Architecture

```
┌─────────────┐         ┌──────────────────────────┐
│   Browser    │◄──WS───►│  Starlette (ASGI shell)   │
│  (Preact)    │◄─REST──►│  ├─ Connexion (OpenAPI)   │
│              │         │  ├─ AuthMiddleware (JWT)  │
│  Voice:      │◄─P2P──►│  ├─ WS voice signaling     │
│  WebRTC mesh │         │  ├─ WS screenshare signal  │
│              │         │  ├─ WebSocket manager      │
│  Screenshare:│◄─P2P──►│  └─ Static /uploads        │
│  WebRTC mesh │         │    (immutable Cache-Control)│
└─────────────┘         └────────┬─────────────────┘
                          SQLite (WAL mode)
```

- **Frontend** — Preact + Vite, served on port 5173. Vite proxies `/api`, `/ws`, `/uploads` to the backend.
- **Backend** — Python 3.12 ASGI app. Starlette wraps Connexion (OpenAPI-driven routes), a native WebSocket endpoint, and a static file mount for uploads.
- **Database** — SQLite with WAL mode, single-writer asyncio queue for mutations, separate async session pool for reads.
- **Voice** — Peer-to-peer WebRTC (mesh). Backend is signaling-only relay; audio flows directly between browsers via RTCPeerConnection.
- **Screen sharing** — Peer-to-peer WebRTC (mesh). Backend is signaling-only relay over the existing WebSocket.
- **Media transcoding** — Client-side re-encoding before upload: images → AVIF via `@jsquash/avif` (WASM), animated GIFs → H.264 MP4 via WebCodecs + `mp4-muxer`. Server accepts AVIF and MP4 in addition to original formats. Static uploads served with immutable cache headers.

---

## 2. Repository Layout

```
microcord/
├── docker-compose.yml          # Dev: two services — frontend (5173), backend (8000)
├── docker-compose.prod.yml     # Prod: single service — app (8000)
├── Dockerfile                  # Dev frontend image (node:22-alpine, vite --host)
├── Dockerfile.prod             # Prod multi-stage: node build + python runtime
├── README.md
├── docs/
│   ├── INTROSPECTION.md        # Cursor rule: keep this guide in sync
│   └── repo-guide.md           # ← you are here
├── backend/
│   ├── Dockerfile              # Python image, uvicorn --reload
│   ├── requirements.txt
│   ├── app.py                  # Starlette entrypoint (routes, middleware, lifespan)
│   ├── constants.py            # All env-backed config constants
│   ├── openapi/
│   │   └── spec.yaml           # OpenAPI 3.0 spec — all endpoints & schemas
│   ├── api/                    # Route handlers (operationId targets)
│   │   ├── auth.py             # register, login, me, status, ws_ticket, logout
│   │   ├── chat.py             # list_messages, send_message
│   │   ├── users.py            # list_users, get_user, update_user
│   │   ├── voice.py            # join, leave, participants, config
│   │   └── upload.py           # upload_file, upload_avatar
│   ├── models/
│   │   ├── base.py             # SQLAlchemy async engine, init_db, column migration
│   │   ├── user.py             # User model
│   │   └── message.py          # Message model
│   ├── services/
│   │   ├── auth.py             # JWT encode/decode, bcrypt, AuthMiddleware, AuthProvider protocol, LocalProvider
│   │   ├── db_writer.py        # Single-writer asyncio queue for SQLite safety
│   │   ├── guard.py            # Rate limiting (exponential backoff), token revocation, registration passphrase
│   │   ├── voice_room.py       # In-memory voice participants, single-sharer tracking
│   │   └── ws_ticket.py        # One-time-use, 30-second TTL WebSocket ticket system
│   └── ws/
│       ├── manager.py          # Per-user WebSocket map, broadcast, send_to
│       └── handler.py          # WS endpoint: JWT auth, chat relay, voice + screenshare signaling
├── frontend/
│   ├── package.json
│   ├── vite.config.js          # Preact preset, proxy to backend container
│   ├── ui.config.js            # App name, voice channel name, screenshare resolution, media transcoding config
│   ├── index.html
│   └── src/
│       ├── main.jsx            # Mount <App />, import global styles
│       ├── app.jsx             # Shell: login vs main window, hook composition, resizable sidebar
│       ├── constants.js        # API_BASE, WS_URL, storage keys, version, page size, MEDIA_TRANSCODE
│       ├── hooks/
│       │   ├── use-user.js     # Auth (register/login/logout), profile update, avatar upload
│       │   ├── use-chat.js     # Paginated messages, WebSocket for live chat_message, media transcoding before upload
│       │   ├── use-voice.js    # Voice join/leave, WebRTC mesh for P2P audio, per-user GainNode volume
│       │   └── use-screenshare.js  # WebRTC mesh, signaling over shared WS
│       ├── services/
│       │   └── media-transcode.js  # maybeTranscode(): AVIF/MP4 encoding, size cap enforcement
│       ├── components/
│       │   ├── login-screen.jsx
│       │   ├── sidebar/
│       │   │   ├── sidebar.jsx             # Voice channel, participant list, screenshare controls
│       │   │   ├── user-profile-modal.jsx
│       │   │   └── sidebar.module.css
│       │   ├── chat/
│       │   │   ├── chat-panel.jsx          # Message list, scroll/pagination, screenshare split
│       │   │   ├── message.jsx             # Single message: markdown (snarkdown + DOMPurify), images, inline video (.mp4)
│       │   │   ├── message-input.jsx       # Compose bar with image/video upload, config-driven size caps
│   ├── services/
│   │   │   │   └── media-transcode.js  # Client-side AVIF/MP4 transcoding
│   │   │   └── *.module.css
│       │   └── screenshare/
│       │       ├── screenshare-view.jsx    # Video element, fullscreen, volume
│       │       └── screenshare-view.module.css
│       └── styles/
│           ├── theme.css       # Dark-mode CSS custom properties
│           └── reset.css
├── data/                       # (gitignored) SQLite DB, .jwt_secret
└── uploads/                    # (gitignored) Uploaded images and videos (UUID filenames, immutable cache)
```

---

## 3. API Endpoints

All HTTP endpoints are defined in `backend/openapi/spec.yaml` and served under `/api`.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/auth/status` | `api.auth.status` | Auth provider info (`{ "provider": "local" }`) |
| POST | `/api/auth/register` | `api.auth.register` | Register (name + password + passphrase) → user + JWT. Rate limited: 3/hour/IP |
| POST | `/api/auth/login` | `api.auth.login` | Login (name + password) → user + JWT. Rate limited: 5/min/IP |
| POST | `/api/auth/logout` | `api.auth.logout` | Revoke current JWT (server-side logout) |
| POST | `/api/auth/ws-ticket` | `api.auth.ws_ticket` | Issue one-time WebSocket ticket (requires JWT) |
| GET | `/api/auth/me` | `api.auth.me` | Current user from JWT |
| GET | `/api/users` | `api.users.list_users` | List all users |
| GET | `/api/users/{id}` | `api.users.get_user` | Get user by ID |
| PATCH | `/api/users/{id}` | `api.users.update_user` | Update own display_name (IDOR-protected) |
| GET | `/api/messages` | `api.chat.list_messages` | Paginated history (`?limit=&cursor=`) |
| POST | `/api/messages` | `api.chat.send_message` | Send message (author from JWT, broadcasts via WS). Rate limited: 10/10s/user |
| POST | `/api/upload` | `api.upload.upload_file` | Upload image/video (PNG/JPEG/GIF/WebP/AVIF/MP4, max 50 MB, magic-byte validated). Rate limited: 5/min/user |
| POST | `/api/avatar` | `api.upload.upload_avatar` | Upload avatar (max 1 MB, JPEG/PNG/AVIF). Rate limited: 5/min/user |
| POST | `/api/voice/join` | `api.voice.join_voice` | Join voice channel |
| POST | `/api/voice/leave` | `api.voice.leave_voice` | Leave voice channel |
| GET | `/api/voice/participants` | `api.voice.get_participants` | Current voice participants (includes `sharing` flag) |
| GET | `/api/voice/config` | `api.voice.get_voice_config` | ICE server configuration for WebRTC |
| WS | `/ws?ticket=<ticket>` | `ws.handler.websocket_endpoint` | Real-time events, voice + screenshare signaling. Max message size: 64 KB |

Swagger UI: `http://localhost:8000/api/ui/`

---

## 4. WebSocket Protocol

All real-time communication flows through a single WebSocket at `/ws?ticket=<one-time-ticket>`.

The client first obtains a ticket via `POST /api/auth/ws-ticket` (requires JWT), then passes the ticket as a query parameter on WebSocket connect. Tickets are one-time-use and expire after 30 seconds.

### JSON message types

| Type | Direction | Payload / Purpose |
|------|-----------|-------------------|
| `chat_message` | Server → Client | New message broadcast (same shape as `Message` schema) |
| `voice_participant_joined` | Server → Client | User joined voice |
| `voice_participant_left` | Server → Client | User left voice |
| `user_updated` | Server → Client | User profile changed (display_name, avatar) |
| `screenshare_start` | Both | User started sharing; also sent on new connect if someone is sharing |
| `screenshare_stop` | Both | User stopped sharing |
| `screenshare_signal` | Both | WebRTC signaling relay (SDP offer/answer, ICE candidate) |
| `screenshare_request` | Both | Viewer requests stream from sharer (reconnect flow) |
| `screenshare_error` | Server → Client | Sharing rejected (e.g. someone already sharing) |
| `voice_signal` | Both | WebRTC signaling relay for voice (SDP offer/answer, ICE candidate) |

---

## 5. Environment Variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `AUTH_PROVIDER` | `local` | Backend | Auth backend (`local` = bcrypt + SQLite) |
| `JWT_SECRET` | *(auto-generated)* | Backend | HMAC secret (≥32 chars); saved to `data/.jwt_secret` on first boot if omitted |
| `JWT_EXPIRY_HOURS` | `24` | Backend | Token lifetime in hours |
| `CORS_ORIGIN` | `http://localhost:5173` | Backend | Allowed CORS origin |
| `REGISTRATION_PASSPHRASE` | *(auto-generated)* | Backend | 6-digit hex uppercase passphrase required for registration; auto-generated and logged on startup if not set |
| `ICE_SERVERS` | `[{"urls":"stun:stun.l.google.com:19302"}]` | Backend | JSON array of ICE server objects for WebRTC (STUN/TURN) |
| `CHOKIDAR_USEPOLLING` | `true` | Frontend (Docker) | Enable file-system polling for Vite HMR in containers |

---

## 6. Data Models

### User (`backend/models/user.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `name` | String(40), unique | Login username |
| `display_name` | String(40), nullable | Shown in UI; falls back to `name` |
| `avatar_url` | String, nullable | Path under `/uploads/` |
| `password_hash` | String | bcrypt hash |
| `is_admin` | Boolean | Default `False` |
| `created_at` | DateTime | UTC, auto-set |

### Message (`backend/models/message.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `author_id` | UUID (FK → User) | Set from JWT, never from request body |
| `content` | Text | Markdown-rendered on the client |
| `image_url` | String, nullable | Must start with `/uploads/` |
| `created_at` | DateTime | UTC, auto-set |

---

## 7. Dependencies

### Backend (`backend/requirements.txt`)

| Package | Purpose |
|---------|---------|
| `connexion[flask,uvicorn,swagger-ui] >=3.1` | OpenAPI-driven HTTP routing, Swagger UI, ASGI server |
| `sqlalchemy[asyncio] >=2.0` | Async ORM for SQLite |
| `aiosqlite >=0.20` | Async SQLite driver |
| `python-multipart >=0.0.9` | Multipart form parsing (file uploads) |
| `pyjwt[crypto] >=2.8` | JWT encode/decode (HS256) |
| `bcrypt >=4.0` | Password hashing |

Starlette is provided transitively through Connexion.

### Frontend (`frontend/package.json`)

| Package | Purpose |
|---------|---------|
| `preact ^10.25.4` | UI framework |
| `7.css ^0.21.1` | Windows-7-style glass window chrome |
| `dompurify ^3.2.4` | HTML sanitization for rendered markdown |
| `snarkdown ^2.0.0` | Lightweight markdown → HTML |
| `animejs ^4.3.6` | Animations |
| `@jsquash/avif ^1.4.0` | AVIF image encoding (WASM, lazy-loaded) |
| `mp4-muxer ^5.2.0` | MP4 container muxing for GIF→video conversion |
| `vite ^6.3.1` (dev) | Build tool / dev server |
| `@preact/preset-vite ^2.9.4` (dev) | Preact integration for Vite |

---

## 8. Data Flows

### Authentication

1. Client `POST /api/auth/register` with `{ name, password, passphrase }` or `POST /api/auth/login` with `{ name, password }`.
2. Registration requires the server passphrase (auto-generated on startup, logged to console; override via `REGISTRATION_PASSPHRASE` env var).
3. Both endpoints are rate limited (register: 3/hour/IP; login: 5/min/IP). Exceeding limits triggers exponential backoff up to a cap.
4. Backend validates credentials (bcrypt verify for login, bcrypt hash for register).
5. Returns `{ user, token }` — JWT (HS256, issuer/audience: `microcord`, expiry from env).
6. Client stores `token` and `user` in `localStorage`.
7. All subsequent HTTP requests include `Authorization: Bearer <token>`.
8. For WebSocket, client first calls `POST /api/auth/ws-ticket` to obtain a one-time ticket, then connects with `?ticket=<ticket>`. The ticket is consumed on handshake and expires in 30 seconds.
9. `AuthMiddleware` enforces JWT on all HTTP routes except `/api/auth/*` and `/uploads/*`. Revoked tokens are rejected.
10. `POST /api/auth/logout` revokes the current JWT server-side (in-memory blocklist), preventing reuse of stolen tokens.

### Chat message

1. Client `POST /api/messages` with `{ content, image_url? }`.
2. Handler enqueues DB write via `db_writer` (single-writer queue).
3. After write, `ws_manager.broadcast` sends `chat_message` to all connected WebSocket clients.
4. Clients receive and render in real time; `use-chat.js` appends to local message list.
5. Pagination: `GET /api/messages?limit=30&before=<uuid>` fetches older pages on scroll-up.

### Media upload & transcoding

1. Client selects an image or video file in `message-input.jsx`.
2. File size is validated against config-driven caps: 14 MB for images, 70 MB for video/GIF (when `mediaTranscode.enabled`); 50 MB universal cap when disabled.
3. Before upload, `maybeTranscode()` in `media-transcode.js` re-encodes:
   - Images (non-GIF) → AVIF via `@jsquash/avif` WASM. Fallback: WebP via OffscreenCanvas.
   - Animated GIFs → H.264 MP4 via `ImageDecoder` + `VideoEncoder` (WebCodecs) + `mp4-muxer`. Fallback: original GIF.
4. If transcoded output is larger than the original, the original is kept (subject to 50 MB cap).
5. Client `POST /api/upload` with the (possibly transcoded) file.
6. Backend validates extension + magic bytes (PNG/JPEG/GIF/WebP/AVIF/MP4).
7. File saved to `uploads/` with a UUID filename, served with `Cache-Control: immutable`.
8. Returns `{ url: "/uploads/<uuid>.<ext>" }`.
9. Client includes `image_url` in the subsequent `POST /api/messages`.
10. Frontend renders `.mp4` URLs as `<video autoplay loop muted playsinline>` with lightbox support.

### Voice

1. Client `POST /api/voice/join` → backend adds user to in-memory `voice_room`, returns participant list.
2. `voice_participant_joined` broadcast to all WS clients.
3. Joiner creates an `RTCPeerConnection` (mesh) to each existing participant and sends SDP offers via `voice_signal`.
4. Existing participants receive offers, create answers, and send them back via `voice_signal`.
5. Audio flows peer-to-peer (WebRTC). Backend only relays signaling messages, never audio data.
6. Remote audio routed through `AudioContext` + per-user `GainNode` for volume control.
7. `POST /api/voice/leave` or WS disconnect cleans up peer connections; `voice_participant_left` broadcast.

### Screen sharing

1. Sharer sends `screenshare_start` over WS → backend checks single-sharer constraint.
2. If allowed, broadcasts `screenshare_start` to all clients.
3. Viewers send `screenshare_request` → relayed to sharer.
4. Sharer creates WebRTC peer connection, sends SDP offer via `screenshare_signal`.
5. All signaling (offers, answers, ICE candidates) relayed through backend WS.
6. Media flows peer-to-peer (WebRTC). Backend never touches video/audio data.
7. `screenshare_stop` on disconnect or explicit stop; backend clears sharer state.

---

## 9. Deployment & Running

### Prerequisites

- Docker and Docker Compose

### Development

```bash
docker compose up --build
```

Two containers: frontend (Vite dev server, port 5173) and backend (uvicorn `--reload`, port 8000). Source directories are bind-mounted for hot reload.

| URL | Service |
|-----|---------|
| `http://localhost:5173` | App (frontend, Vite HMR) |
| `http://localhost:8000/api/ui/` | Swagger UI |

OpenAPI spec changes (`spec.yaml`) require a manual backend restart.

### Production

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Single container. `Dockerfile.prod` runs a multi-stage build: Node builds the frontend to static files, then Python serves everything (API + static frontend + uploads) on port 8000.

| URL | Service |
|-----|---------|
| `http://localhost:8000` | App (frontend + API) |
| `http://localhost:8000/api/ui/` | Swagger UI |

The backend detects the `static/frontend/` directory at startup and serves it as a catch-all — requests to `/api/*` go to Connexion, everything else serves the built frontend. In dev (no build present), behavior is unchanged.

Configure via environment variables or a `.env` file alongside `docker-compose.prod.yml`:

```
JWT_SECRET=your-secret-at-least-32-chars-long
CORS_ORIGIN=https://chat.yourdomain.com
ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]
```

In production, frontend and backend share the same origin, so `CORS_ORIGIN` should match the public URL. CORS middleware is a no-op for same-origin requests.

### Persistent volumes

| Host Path | Container Path | Contents |
|-----------|----------------|----------|
| `./data/` | `/app/data` | SQLite DB (`microcord.db`), JWT secret (`.jwt_secret`) |
| `./uploads/` | `/app/uploads` | Uploaded images and videos |

Both directories are gitignored. See README for backup/restore instructions.

---

## 10. Security

| Control | Implementation |
|---------|----------------|
| Auth always on | Every HTTP and WS request requires a valid JWT (WS via one-time ticket) |
| Identity from JWT | Author/user IDs derived from token, never from request bodies |
| IDOR protection | `PATCH /users/{id}` rejects modifications to other users |
| XSS sanitization | Chat markdown rendered with snarkdown, sanitized with DOMPurify |
| JWT algorithm pinning | Only HS256 accepted; `none` and others rejected |
| JWT validation | Issuer, audience, and expiry enforced on every decode |
| Token revocation | `POST /api/auth/logout` adds JWT to in-memory blocklist; checked by `AuthMiddleware` |
| Rate limiting | In-memory with exponential backoff per endpoint: register (3/hr/IP, max 1h), login (5/min/IP, max 5m), messages (10/10s/user, max 1m), uploads (5/min/user, max 2m) |
| Registration passphrase | 6-digit hex uppercase secret required to register; auto-generated and logged on startup, override via `REGISTRATION_PASSPHRASE` env var |
| WS message size limit | Inbound WebSocket messages exceeding 64 KB are dropped |
| CORS lockdown | Restricted to `CORS_ORIGIN` (default `http://localhost:5173`) |
| Upload validation | File extension check + magic byte verification (PNG/JPEG/GIF/WEBP/AVIF/MP4) |
| Upload size limits | Chat images: 50 MB (`MAX_UPLOAD_SIZE_BYTES`), avatars: 1 MB (`MAX_AVATAR_SIZE_BYTES`). Client-side caps: 14 MB images / 70 MB video (when transcoding enabled) |
| Image URL validation | Only `/uploads/`-prefixed URLs accepted in messages and avatars |
| Password storage | bcrypt hashing via `bcrypt >=4.0` |
| Single-writer DB | All mutations through asyncio queue — prevents SQLite concurrent-write corruption |
| Non-root Docker | Both Dockerfiles create and use `appuser` for the process |
| JWT secret permissions | `.jwt_secret` file written with `0o600` permissions |
| Message length limit | `maxLength: 4000` enforced in OpenAPI spec for message content |
