# Microcord

Minimal self-hosted Discord-like app with text chat, voice channels, and screen sharing.

## Quick Start

```bash
docker compose up --build
```

Open **http://localhost:5173** -- register an account and start chatting.

Swagger UI is available at **http://localhost:8000/api/ui/**.

### Ports

| Service  | Port |
|----------|------|
| Frontend | 5173 |
| Backend  | 8000 |

### Persistent Data

SQLite database and uploaded files are stored in host-mounted directories for easy backup:

| Host Path   | Container Path | Contents |
|-------------|----------------|----------|
| `./data/`   | `/app/data`    | SQLite DB (`microcord.db`), JWT secret (`.jwt_secret`) |
| `./uploads/`| `/app/uploads` | Uploaded images |

Both directories are gitignored.

### Backup & Restore

**Backup** (while running or stopped):

```bash
# Safe SQLite copy (handles WAL journaling)
sqlite3 ./data/microcord.db "VACUUM INTO './microcord-backup.db'"

# Copy uploaded files and JWT secret
cp -r ./uploads/ ./backup-uploads/
cp ./data/.jwt_secret ./backup-jwt_secret
```

If `sqlite3` is not available, you can stop the server first and copy the files directly:

```bash
docker compose stop backend
cp -r ./data/ ./backup-data/
cp -r ./uploads/ ./backup-uploads/
docker compose start backend
```

**Restore**:

```bash
docker compose stop backend
cp ./microcord-backup.db ./data/microcord.db
cp -r ./backup-uploads/* ./uploads/
cp ./backup-jwt_secret ./data/.jwt_secret
docker compose start backend
```

**What to back up**:

| File | Required | Notes |
|------|----------|-------|
| `./data/microcord.db` | Yes | All users, messages, and settings |
| `./data/.jwt_secret` | Yes | Without this, existing JWTs become invalid after restore |
| `./uploads/*` | Yes | All uploaded images referenced by messages |

### Authentication

Auth is **always enabled**. The default provider is `local` (username/password with bcrypt + JWT).

To set a specific JWT secret:

```bash
JWT_SECRET="your-secret-at-least-32-chars-long" docker compose up --build
```

Or set the variables in a `.env` file:

```
JWT_SECRET=your-secret-at-least-32-chars-long
JWT_EXPIRY_HOURS=24
CORS_ORIGIN=http://localhost:5173
```

If `JWT_SECRET` is omitted, a random one is auto-generated on first boot and saved to `./data/.jwt_secret`.

#### Auth Provider

The `AUTH_PROVIDER` env var controls which authentication backend is used. Currently supported:

| Provider | Value | Description |
|----------|-------|-------------|
| Local    | `local` (default) | Username/password stored in SQLite with bcrypt |

The architecture uses an `AuthProvider` protocol (`services/auth.py`) that can be extended with additional providers (e.g. OIDC for PocketID/LLDAP). The `/api/auth/status` endpoint returns `{ "provider": "local" }` so frontends can adapt their login UI per provider.

### UI Configuration

Edit `frontend/ui.config.js` to change the app display name and voice channel label without touching component code:

```javascript
export const UI_CONFIG = {
  appName: 'Microcord',
  voiceChannelName: 'Voice Lounge',
};
```

The browser tab title falls back to `appName` automatically.

## What Works

- **Text chat** -- markdown rendering (bold, italic, code, links), image attachments with upload, inline preview and lightbox
- **Paginated history** -- last 30 messages loaded on open, older messages fetched on scroll-up
- **Voice channel** -- WebSocket-based Opus audio streaming with per-user volume control, join/leave with participant list
- **Screen sharing** -- peer-to-peer WebRTC mesh (up to ~5 viewers), with video + system audio, loading indicator, fullscreen, volume slider, and disconnect/reconnect
- **Real-time** -- messages broadcast instantly via WebSocket to all connected clients
- **User profiles** -- editable display name and avatar URL, clickable in sidebar
- **Authentication** -- JWT-based username/password auth with bcrypt, provider pattern for future OIDC / LLDAP support
- **Dark mode** -- only mode, all CSS custom properties
- **Resizable sidebar** -- drag the divider between voice panel and chat
- **Graceful disconnect** -- voice and screenshare clean up on page reload/close

### Security

- **Auth always on** -- every request (HTTP and WebSocket) requires a valid JWT
- **Identity from JWT only** -- author/user IDs are always derived from the token, never from request bodies
- **IDOR protection** -- users can only modify their own profile
- **XSS sanitization** -- chat messages sanitized with DOMPurify before rendering
- **JWT algorithm pinning** -- only HS256 accepted, `none` and other algorithms rejected
- **JWT validation** -- issuer, audience, and expiry enforced on every token
- **CORS lockdown** -- restricted to `CORS_ORIGIN` (default `http://localhost:5173`)
- **Upload validation** -- file extension check + magic byte verification (PNG/JPEG/GIF/WEBP), 10 MB limit
- **Image URL validation** -- only `/uploads/` prefixed URLs accepted in messages and avatars

## Architecture

```
┌─────────────┐         ┌──────────────────────────┐
│   Browser    │◄──WS───►│  Starlette (ASGI shell)   │
│  (Preact)    │◄─REST──►│  ├─ Connexion (OpenAPI)   │
│              │         │  ├─ AuthMiddleware (JWT)  │
│  Voice: WS   │◄──WS───►│  ├─ WS audio relay        │
│  audio relay │         │  ├─ WS screenshare signal  │
│              │         │  ├─ WebSocket manager      │
│  Screenshare:│◄─P2P──►│  └─ Static /uploads        │
│  WebRTC mesh │         └────────┬─────────────────┘
└─────────────┘                  │
                          SQLite (WAL mode)
```

### Frontend (`frontend/`)

Preact + Vite with CSS Modules. Vite proxies `/api`, `/ws`, and `/uploads` to the backend container.

| Directory | Purpose |
|-----------|---------|
| `ui.config.js` | Server-level display config (app name, voice channel name) |
| `src/hooks/` | `useUser` (auth), `useChat` (REST+WS+pagination), `useVoice` (WS audio), `useScreenshare` (WebRTC mesh + signaling) |
| `src/components/` | Sidebar (voice + profile + share), ChatPanel (with screenshare split), ScreenshareView, Message, MessageInput, LoginScreen, UserProfileModal |
| `src/styles/` | Dark theme CSS variables, reset |

### Backend (`backend/`)

Python 3.12, Connexion 3 (OpenAPI 3.0), SQLAlchemy 2 (async), PyJWT, bcrypt.

| Directory | Purpose |
|-----------|---------|
| `openapi/spec.yaml` | Full API spec -- all endpoints, schemas, security schemes |
| `api/` | Route handlers: `users`, `chat`, `voice`, `upload`, `auth` |
| `models/` | SQLAlchemy models: `User` (with password_hash, is_admin), `Message` |
| `services/auth.py` | JWT encode/decode, bcrypt, AuthMiddleware, AuthProvider protocol, LocalProvider |
| `services/db_writer.py` | Single-writer asyncio task for SQLite safety |
| `services/voice_room.py` | Voice participant management, screenshare state (single sharer tracking) |
| `ws/` | WebSocket handler: chat broadcast, binary audio relay, screenshare signaling (`start`/`stop`/`signal`/`request`) |

### Single-Writer Pattern

All DB writes go through an `asyncio.Queue` consumed by a single writer task. Reads use a separate session pool. SQLite WAL mode allows concurrent readers. This is trivially swappable to MySQL/Postgres by changing `DB_URL` and removing the writer queue.

### Voice

Audio is streamed as Opus-encoded WebSocket binary frames. Each frame carries a user ID header so the backend can relay it to all other voice participants. The frontend uses `MediaRecorder` (Opus) to capture and `AudioContext` with per-user `GainNode` for playback and individual volume control. Opus bitrate and frame size are configurable via `VOICE_OPUS_BITRATE` and `VOICE_OPUS_FRAME_MS` environment variables.

### Screen Sharing

Uses peer-to-peer WebRTC (mesh topology). The backend acts as a **signaling-only relay** -- it forwards SDP offers/answers and ICE candidates between peers over the existing WebSocket. Video and system audio flow directly browser-to-browser. Only one user can share at a time. The sharing participant list badge and Watch button allow viewers to disconnect and reconnect. Designed for small groups (2-5 people).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/status` | Auth provider info |
| POST | `/api/auth/register` | Register with password |
| POST | `/api/auth/login` | Login with password |
| GET | `/api/auth/me` | Current user from JWT |
| GET | `/api/users` | List users |
| GET | `/api/users/{id}` | Get user |
| PATCH | `/api/users/{id}` | Update own display name / avatar |
| GET | `/api/messages` | Paginated history (`?limit=&before=`) |
| POST | `/api/messages` | Send message (author from JWT, broadcasts via WS) |
| POST | `/api/upload` | Upload image (max 10 MB, magic byte validated) |
| POST | `/api/voice/join` | Join voice channel (user from JWT) |
| POST | `/api/voice/leave` | Leave voice channel (user from JWT) |
| GET | `/api/voice/participants` | Current voice participants (includes `sharing` flag) |
| GET | `/api/voice/config` | Opus bitrate/frame config |
| WS | `/ws?token=` | Real-time events, audio relay, screenshare signaling |

### WebSocket Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `chat_message` | Server → Client | New chat message broadcast |
| `voice_participant_joined` | Server → Client | User joined voice |
| `voice_participant_left` | Server → Client | User left voice |
| `screenshare_start` | Both | User started sharing (sent on new WS connect if active) |
| `screenshare_stop` | Both | User stopped sharing |
| `screenshare_signal` | Both | WebRTC signaling relay (SDP offer/answer, ICE candidate) |
| `screenshare_request` | Both | Viewer requests stream from sharer (for reconnect) |
| `screenshare_error` | Server → Client | Sharing rejected (e.g. someone already sharing) |
| *(binary)* | Both | Opus audio frames with user ID header |

## Development

Source files are bind-mounted into containers. Frontend changes trigger Vite HMR instantly. Backend runs with `uvicorn --reload` (restart manually after OpenAPI spec changes).

Everything runs in Docker.
