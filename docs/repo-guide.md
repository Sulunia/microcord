# Microcord — Repo Guide

Minimal self-hosted Discord-like app with text chat, voice channels, and screen sharing.
Version **0.9.2**.

---

## 1. High-Level Architecture

```
┌─────────────┐         ┌──────────────────────────┐
│   Browser    │◄──WS───►│  Starlette (ASGI shell)   │
│  (Preact)    │◄─REST──►│  ├─ Connexion (OpenAPI)   │
│              │         │  ├─ SecurityHeadersMiddleware │
│  ├─ AuthMiddleware (JWT access token + type claim)  │
│  Voice:      │◄─P2P──►│  ├─ WS voice signaling     │
│  WebRTC mesh │         │  ├─ WS screenshare signal  │
│              │         │  ├─ WebSocket manager      │
│  Screenshare:│◄─P2P──►│  └─ Static /uploads        │
│  WebRTC mesh │         └────────┬─────────────────┘
└─────────────┘                  │
                          SQLite (WAL mode)
```

- **Frontend** — Preact + Vite, served on port 5173. Vite proxies `/api`, `/ws`, `/uploads` to the backend. A shared `RealtimeProvider` context owns the single WebSocket connection; all hooks consume `useRealtime()` for send/subscribe. Theme is applied at boot in `main.jsx` via `initTheme()` before Preact mounts.
- **Backend** — Python 3.12 ASGI app. Starlette wraps Connexion (OpenAPI-driven routes), a native WebSocket endpoint, and a static file mount for uploads.
- **Database** — SQLite with WAL mode, single-writer asyncio queue for mutations, separate async session pool for reads.
- **Voice** — Peer-to-peer WebRTC (mesh). Backend is signaling-only relay; audio flows directly between browsers via RTCPeerConnection. Frontend voice logic is split into focused modules: `use-voice.js` (orchestrator), `use-voice-mesh.js` (WebRTC peers + audio elements), `use-voice-participants.js` (participant state + WS events), `voice-sdp.js` (SDP munging), `vad-monitor.js` (VAD).
- **Screen sharing** — Peer-to-peer WebRTC (mesh). Backend is signaling-only relay over the existing WebSocket.

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
│   ├── repo-guide.md           # ← you are here
│   └── security-audit.md       # Security audit notes
├── backend/
│   ├── Dockerfile              # Python image, uvicorn --reload
│   ├── requirements.txt
│   ├── app.py                  # Starlette entrypoint (routes, middleware, lifespan)
│   ├── constants.py            # All env-backed config constants
│   ├── openapi/
│   │   └── spec.yaml           # OpenAPI 3.0 spec — all endpoints & schemas
│   ├── api/                    # Route handlers (operationId targets)
│   │   ├── auth.py             # register, login, me, status, ws_ticket, refresh, logout
│   │   ├── chat.py             # list_messages, send_message, delete_message (channel_id aware)
│   │   ├── channels.py         # list_channels, create_channel, update_channel, delete_channel (admin/owner only)
│   │   ├── config.py           # get_branding (app name, voice channel name)
│   │   ├── livemedia.py        # get_live_media_config (ICE, audio, screenshare, media processing)
│   │   ├── users.py            # list_users, get_user, update_user, get_online_users, set_user_admin
│   │   ├── voice.py            # join, leave, participants
│   │   └── upload.py           # upload_file, upload_avatar (thin orchestration via services/utils/)
│   ├── database/
│   │   ├── models.py           # SQLAlchemy models (User, Channel, Message, RefreshToken)
│   │   └── repository.py      # Async repository (single-writer queue for SQLite safety; migrate_owner, migrate_default_channel, channel CRUD)
│   ├── services/
│   │   ├── auth.py             # Access/refresh token creation, rotation, JWT encode/decode, bcrypt, AuthMiddleware, AuthProvider protocol, LocalProvider; JWT includes is_admin/is_owner claims
│   │   ├── security_headers.py # Security headers middleware (X-Content-Type-Options, HSTS, CSP, etc.)
│   │   ├── guard.py            # Rate limiting (exponential backoff), token revocation, registration passphrase
│   │   ├── media_manager.py    # Background ffmpeg worker: images→AVIF, videos/GIFs→AV1/MP4 (GIFs skip scaling); typed jobs (MessageMediaJob, AvatarJob)
│   │   ├── voice_room.py       # In-memory voice participants, per-user mute/speaking state, single-sharer tracking
│   │   ├── ws_ticket.py        # One-time-use, 30-second TTL WebSocket ticket system
│   │   └── utils/
│   │       ├── media_validator.py  # File-type validation (extension whitelists, magic-byte inspection)
│   │       ├── upload_storage.py   # Streaming file uploads to disk with size enforcement
│   │       └── avatar_service.py   # Avatar upload lifecycle (validation, storage, cleanup, DB update, WS broadcast)
│   └── ws/
│       ├── manager.py          # Per-user WebSocket map, broadcast, send_to
│       └── handler.py          # WS endpoint: JWT auth, chat relay (channel_id), voice + screenshare signaling, presence (online/offline), channel events
├── frontend/
│   ├── package.json
│   ├── vite.config.js          # Preact preset, proxy to backend container
│   ├── index.html
│   └── src/
│       ├── main.jsx            # Mount <App />, import global styles, initTheme() before render
│       ├── app.jsx             # Shell: login vs main window, <RealtimeProvider> wrapper, <AuthenticatedApp> with hook composition (useChannels → useChat), resizable sidebar, toggleable members sidebar
│       ├── constants.js        # API_BASE, WS_URL, storage keys, version, page size, notification sound constants; re-exports UI_CONFIG, LIVE_MEDIA_CONFIG
│       ├── runtime-config.js   # UI_CONFIG: app name, voice channel name (fetched from /api/branding)
│       ├── live-media-config.js # LIVE_MEDIA_CONFIG: ICE, audio, screenshare, media (fetched from /api/livemediaconfig)
│       ├── hooks/
│       │   ├── realtime.jsx        # RealtimeProvider context + useRealtime() hook; owns WS lifecycle (ticket, connect, reconnect); exposes send/subscribe/connected
│       │   ├── webrtc-helpers.js   # createPeerMap() factory — shared peer-connection map with closePeer, closeAllPeers, sendOffer, applySignal
│       │   ├── vad-monitor.js      # startVadMonitor(stream, { prefsRef, onSpeakingChange }) — reusable RMS-based VAD; returns { stop }
│       │   ├── use-audio-preferences.js # useAudioPreferences() — reactive localStorage-backed audio prefs (input/output/vadSensitivity) with prefsRef for hot loops
│       │   ├── audio-notifications.js # playNotification(url, volume) — cached notification sound playback; SOUND_ENTER_VOICE / SOUND_EXIT_VOICE constants
│       │   ├── use-latest.js       # useLatest(value) — returns a stable ref that always holds the latest value (replaces manual ref-mirror pattern)
│       │   ├── use-live-media-config.js # useLiveMediaConfig() — initialises LIVE_MEDIA_CONFIG once, exposes iceServers / audioConfig / screenshareConfig
│       │   ├── voice-sdp.js        # mungeOpusSdp(sdp, bitrate, stereo) — injects Opus fmtp parameters into SDP
│       │   ├── use-voice-mesh.js   # useVoiceMesh({ send, streamRef, vadSpeakingRef, isMutedRef }) — WebRTC mesh: peer connections, audio senders, remote audio elements, SDP munging, disposePeer/disposeAllPeers/setVolume
│       │   ├── use-voice-participants.js # useVoiceParticipants({ joinStateRef, onParticipantLeft, onSignal }) — participant REST fetch, speakingUsers state, WS subscriptions for join/leave/mute/speaking/signal events
│       │   ├── use-user.js         # Auth (register/login/logout), access/refresh token management, authedFetch interceptor, profile update, avatar upload
│       │   ├── use-chat.js         # Paginated messages (per-channel via channel_id), subscribe to chat_message / presence events via useRealtime, presence tracking (online user IDs), setUserAdmin
│       │   ├── use-channels.js     # Channel state management: fetch, WS subscriptions (presence_init, channel_created/updated/deleted), create/rename/delete, active channel tracking, unread counts
│       │   ├── use-voice.js        # Thin orchestrator composing useVoiceMesh + useVoiceParticipants + VAD; join/leave state machine, mute toggle, cleanup ownership
│       │   ├── use-screenshare.js  # WebRTC mesh via createPeerMap, signaling over useRealtime
│       │   └── use-theme.js        # Light/dark theme toggle, persisted in localStorage
│       ├── components/
│       │   ├── login-screen.jsx
│       │   ├── login-screen.module.css
│       │   ├── alert-modal.jsx
│       │   ├── alert-modal.module.css
│       │   ├── sidebar/
│       │   │   ├── sidebar.jsx             # Voice channel, participant list, VAD speaking indicator, screenshare controls
│       │   │   ├── server-setup-modal.jsx  # Admin server setup modal (channel management with delete confirmation)
│       │   │   ├── user-profile-modal.jsx  # Profile edit, audio device selection, VAD sensitivity slider with live mic indicator, server admin button (admin/owner only)
│       │   │   └── sidebar.module.css
│       │   ├── chat/
│       │       │   ├── chat-panel.jsx          # Message list, scroll/pagination, screenshare split, header bar with channel tabs, context menu for rename/delete, create channel modal
│       │   │   ├── members-sidebar.jsx     # Toggleable right sidebar: all users grouped by online/offline status with presence dots; role badges (👑 owner, ⭐ admin); admin context menu for promote/demote
│       │   │   ├── message.jsx             # Single message: markdown (snarkdown + DOMPurify), images
│       │       │   ├── message-input.jsx       # Compose bar with upload, dynamic channel name placeholder
│       │   │   └── *.module.css
│       │   └── screenshare/
│       │       ├── screenshare-view.jsx    # Video element, fullscreen, volume
│       │       └── screenshare-view.module.css
│       └── mobile/
│           ├── mobile-layout.jsx     # Mobile tabs (chat/voice), channel picker dropdown, create channel modal
│           └── mobile-layout.module.css
│       └── styles/
│           ├── theme.css       # Dark-mode CSS custom properties
│           └── reset.css
├── data/                       # (gitignored) SQLite DB, .jwt_secret
└── uploads/                    # (gitignored) Uploaded images
```

---

## 3. API Endpoints

All HTTP endpoints are defined in `backend/openapi/spec.yaml` and served under `/api`.

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/branding` | `api.config.get_branding` | Public UI branding (app name, voice channel name). No auth required |
| GET | `/api/livemediaconfig` | `api.livemedia.get_live_media_config` | Live media config (ICE servers, audio, screenshare, media processing). Requires JWT |
| GET | `/api/auth/status` | `api.auth.status` | Auth provider info (`{ "provider": "local" }`) |
| POST | `/api/auth/register` | `api.auth.register` | Register (name + password + passphrase) → user + access_token + refresh_token. Rate limited: 3/hour/IP |
| POST | `/api/auth/login` | `api.auth.login` | Login (name + password) → user + access_token + refresh_token. Rate limited: 5/min/IP |
| POST | `/api/auth/logout` | `api.auth.logout` | Revoke current JWT + all refresh tokens for the user (server-side logout) |
| POST | `/api/auth/refresh` | `api.auth.refresh` | Rotate refresh token → new access_token + refresh_token. Rate limited: 10/min/IP |
| POST | `/api/auth/ws-ticket` | `api.auth.ws_ticket` | Issue one-time WebSocket ticket (requires JWT) |
| GET | `/api/auth/me` | `api.auth.me` | Current user from JWT |
| GET | `/api/users` | `api.users.list_users` | List all users (includes `online` boolean) |
| GET | `/api/users/online` | `api.users.get_online_users` | Get currently online user IDs (WebSocket-connected) |
| GET | `/api/users/{id}` | `api.users.get_user` | Get user by ID |
| PATCH | `/api/users/{id}` | `api.users.update_user` | Update own display_name (IDOR-protected) |
| POST | `/api/users/{id}/admin` | `api.users.set_user_admin` | Promote/demote admin status (admin/owner only; cannot modify owner) |
| GET | `/api/messages` | `api.chat.list_messages` | Paginated history (`?limit=&cursor=&channel_id=`); defaults to the default channel |
| POST | `/api/messages` | `api.chat.send_message` | Send message with optional `channel_id` (author from JWT, broadcasts via WS). Rate limited: 10/10s/user |
| DELETE | `/api/messages/{id}` | `api.chat.delete_message` | Hard-delete own message (author from JWT, deletes associated file, broadcasts deletion via WS) |
| GET | `/api/channels` | `api.channels.list_channels` | List all channels |
| POST | `/api/channels` | `api.channels.create_channel` | Create a new channel (admin/owner only, max 20 channels) |
| PATCH | `/api/channels/{channel_id}` | `api.channels.update_channel` | Rename a channel (admin/owner only, cannot rename default) |
| DELETE | `/api/channels/{channel_id}` | `api.channels.delete_channel` | Delete a channel, its messages, and associated media files (admin/owner only, cannot delete default) |
| POST | `/api/upload` | `api.upload.upload_file` | Upload image (max 50 MB, magic-byte validated). Rate limited: 5/min/user |
| POST | `/api/avatar` | `api.upload.upload_avatar` | Upload avatar (max 1 MB, JPEG/PNG/AVIF). Rate limited: 5/min/user |
| POST | `/api/voice/join` | `api.voice.join_voice` | Join voice channel |
| POST | `/api/voice/leave` | `api.voice.leave_voice` | Leave voice channel |
| GET | `/api/voice/participants` | `api.voice.get_participants` | Current voice participants (includes `sharing`, `muted`, and `speaking` flags) |
| WS | `/ws?ticket=<ticket>` | `ws.handler.websocket_endpoint` | Real-time events, voice + screenshare signaling. Max message size: 64 KB |

> *(removed 2026-04-24)* `GET /api/voice/config` — superseded by `GET /api/livemediaconfig`
> *(removed 2026-04-24)* `GET /api/config` — superseded by `GET /api/branding`

Swagger UI: `http://localhost:8000/api/ui/`

---

## 4. WebSocket Protocol

All real-time communication flows through a single WebSocket at `/ws?ticket=<one-time-ticket>`.

The client first obtains a ticket via `POST /api/auth/ws-ticket` (requires JWT), then passes the ticket as a query parameter on WebSocket connect. Tickets are one-time-use and expire after 30 seconds.

### JSON message types

| Type | Direction | Payload / Purpose |
|------|-----------|-------------------|
| `chat_message` | Server → Client | New message broadcast (includes `channel_id`; same shape as `Message` schema) |
| `chat_message_deleted` | Server → Client | Message deleted; payload `{ id, channel_id }` — clients remove from local list |
| `voice_participant_joined` | Server → Client | User joined voice |
| `voice_participant_left` | Server → Client | User left voice |
| `user_updated` | Server → Client | User profile changed (display_name, avatar, is_admin, is_owner) |
| `screenshare_start` | Both | User started sharing; also sent on new connect if someone is sharing |
| `screenshare_stop` | Both | User stopped sharing |
| `screenshare_signal` | Both | WebRTC signaling relay (SDP offer/answer, ICE candidate) |
| `screenshare_request` | Both | Viewer requests stream from sharer (reconnect flow) |
| `screenshare_error` | Server → Client | Sharing rejected (e.g. someone already sharing) |
| `voice_signal` | Both | WebRTC signaling relay for voice (SDP offer/answer, ICE candidate) |
| `voice_mute` | Both | User toggled mute state; payload `{ user_id, muted }` — server broadcasts to all clients |
| `voice_speaking` | Both | Client-side VAD detected speaking state change; payload `{ user_id, speaking }` — server broadcasts to all clients (including sender) |
| `presence_init` | Server → Client | Sent on WS connect; payload `{ user_ids, connection_id, channels }` — full list of currently online user IDs and all channels |
| `presence_online` | Server → Client | User connected via WebSocket; payload `{ user_id, user }` — includes user object (with is_admin/is_owner) so new users appear in members list without re-fetch; broadcast to all other clients |
| `presence_offline` | Server → Client | User disconnected from WebSocket; payload `{ user_id }` — broadcast to all clients |
| `channel_created` | Server → Client | New channel created; payload `{ channel }` — broadcast to all clients |
| `channel_updated` | Server → Client | Channel renamed; payload `{ channel }` — broadcast to all clients |
| `channel_deleted` | Server → Client | Channel deleted; payload `{ channel_id }` — broadcast to all clients; clients auto-switch to default channel if active channel was deleted |

---

## 5. Environment Variables

| Variable | Default | Where | Description |
|----------|---------|-------|-------------|
| `AUTH_PROVIDER` | `local` | Backend | Auth backend (`local` = bcrypt + SQLite) |
| `JWT_SECRET` | *(auto-generated)* | Backend | HMAC secret (≥32 chars); saved to `data/.jwt_secret` on first boot if omitted |
| `ACCESS_TOKEN_EXPIRY_MINUTES` | `5` | Backend | Access token lifetime in minutes |
| `REFRESH_TOKEN_EXPIRY_DAYS` | `30` | Backend | Refresh token lifetime in days |
| `CORS_ORIGIN` | `http://localhost:5173` | Backend | Allowed CORS origin |
| `REGISTRATION_PASSPHRASE` | *(auto-generated)* | Backend | 6-digit hex uppercase passphrase required for registration; auto-generated and logged on startup if not set |
| `TRUST_PROXY` | `false` | Backend | Trust `X-Forwarded-For` / `X-Real-IP` headers for rate limiting. Enable when behind a reverse proxy |
| `TRUSTED_PROXY_HOPS` | `1` | Backend | Number of trusted proxy hops for IP extraction |
| `INSECURE_HTTP` | `false` | Backend | Skip HSTS header. Enable for local/dev HTTP; in production, use a TLS-terminating reverse proxy instead |
| `MAX_UPLOAD_SIZE_MB` | `50` | Backend | Maximum upload size in megabytes |
| `APP_NAME` | `🔊 Microcord` | Backend | Application name shown in title bar and login screen |
| `VOICE_CHANNEL_NAME` | `Voice channel` | Backend | Display name for the voice channel in the sidebar |
| `ICE_SERVERS` | `[{"urls":"stun:stun.l.google.com:19302"}]` | Backend | JSON array of ICE server objects for WebRTC (STUN/TURN) |
| `VOICE_ECHO_CANCELLATION` | `true` | Backend | Enable echo cancellation for voice |
| `VOICE_NOISE_SUPPRESSION` | `true` | Backend | Enable noise suppression for voice |
| `VOICE_AUTO_GAIN_CONTROL` | `true` | Backend | Enable automatic gain control for voice |
| `VOICE_OPUS_BITRATE` | `32000` | Backend | Opus codec bitrate (6000–510000 bps) |
| `VOICE_OPUS_STEREO` | `false` | Backend | Enable stereo Opus audio |
| `SCREENSHARE_WIDTH` | `1920` | Backend | Screenshare capture width |
| `SCREENSHARE_HEIGHT` | `1080` | Backend | Screenshare capture height |
| `SCREENSHARE_FRAME_RATE` | `60` | Backend | Screenshare capture frame rate |
| `MEDIA_AVIF_CRF` | `30` | Backend | AVIF encoding quality (lower = better) |
| `MEDIA_AV1_CRF` | `35` | Backend | AV1 video encoding quality |
| `MEDIA_VIDEO_SCALE` | `1.0` | Backend | Video downscale factor (e.g. `0.5` for half resolution). GIFs are excluded from scaling — only transcoded to AV1/MP4 at original resolution |
| `MEDIA_VIDEO_MAX_BITRATE` | *(empty)* | Backend | Max video bitrate (e.g. `0.7M`) |
| `MEDIA_FFMPEG_THREADS` | `2` | Backend | FFmpeg encoding thread count |
| `MEDIA_IMAGE_MAX_DIMENSION` | `1920` | Backend | Maximum image dimension for processing |
| `FFMPEG_MEMORY_LIMIT_MB` | `256` | Backend | FFmpeg memory limit in MB |
| `CHOKIDAR_USEPOLLING` | `true` | Frontend (Docker) | Enable file-system polling for Vite HMR in containers |

> *(removed 2026-04-24)* `APP_TAGLINE` — tagline removed from UI; endpoint no longer returns it
> *(removed 2026-04-28)* `JWT_EXPIRY_HOURS` — replaced by `ACCESS_TOKEN_EXPIRY_MINUTES` and `REFRESH_TOKEN_EXPIRY_DAYS`

---

## 6. Data Models

### User (`backend/database/models.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `name` | String(40), unique | Login username |
| `display_name` | String(40), nullable | Shown in UI; falls back to `name` |
| `avatar_url` | String, nullable | Path under `/uploads/` |
| `password_hash` | String | bcrypt hash |
| `is_admin` | Boolean | Default `False` |
| `is_owner` | Boolean | Default `False`; first registered user is auto-set to owner (cannot be demoted) |
| `tick_sound` | Integer | Notification sound ID (1–4), default `1` |
| `created_at` | DateTime | UTC, auto-set |

### Channel (`backend/database/models.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `name` | String(40), unique | Channel display name (case-insensitive uniqueness enforced in API) |
| `is_default` | Boolean | Default `False`; the default channel ("general") cannot be renamed or deleted |
| `created_at` | DateTime | UTC, auto-set |

### Message (`backend/database/models.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `author_id` | UUID (FK → User) | Set from JWT, never from request body |
| `channel_id` | UUID (FK → Channel), nullable | Channel the message belongs to; nullable for backward compat, auto-filled with default channel if omitted |
| `content` | Text | Markdown-rendered on the client |
| `image_url` | String, nullable | Must start with `/uploads/` |
| `created_at` | DateTime | UTC, auto-set |

### RefreshToken (`backend/database/models.py`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID (PK) | Auto-generated |
| `user_id` | UUID (FK → User) | Token owner |
| `token_hash` | String(128), unique | SHA-256 hash of the raw token (plaintext never stored) |
| `consumed` | Boolean | Set when consumed by a rotation (reuse detection) |
| `created_at` | DateTime | UTC, auto-set |
| `expires_at` | DateTime | When it expires |
| `revoked_at` | DateTime, nullable | When explicitly revoked |

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
| `vite ^6.3.1` (dev) | Build tool / dev server |
| `@preact/preset-vite ^2.9.4` (dev) | Preact integration for Vite |

---

## 8. Data Flows

### Authentication

1. Client `POST /api/auth/register` with `{ name, password, passphrase }` or `POST /api/auth/login` with `{ name, password }`.
2. Registration requires the server passphrase (auto-generated on startup, logged to console; override via `REGISTRATION_PASSPHRASE` env var).
3. Both endpoints are rate limited (register: 3/hour/IP; login: 5/min/IP). Exceeding limits triggers exponential backoff up to a cap.
4. Backend validates credentials (bcrypt verify for login, bcrypt hash for register).
5. Returns `{ user, access_token, refresh_token }` — access token is a short-lived JWT (HS256, default 5 min, `type: "access"` claim); refresh token is a long-lived opaque random token (default 30 days, SHA-256 hashed in DB).
6. Client stores both tokens and `user` in `localStorage`.
7. All subsequent HTTP requests include `Authorization: Bearer <access_token>`. The `authedFetch()` wrapper automatically refreshes on 401. JWT payload includes `is_admin` and `is_owner` claims; these are extracted by `AuthMiddleware` and stored in `scope["state"]["current_user"]`.
8. For WebSocket, client first calls `POST /api/auth/ws-ticket` to obtain a one-time ticket, then connects with `?ticket=<ticket>`. The ticket is consumed on handshake and expires in 30 seconds.
9. `AuthMiddleware` enforces JWT access tokens on all HTTP routes except `/api/auth/*`, `/api/branding`, and `/uploads/*`. It checks the `type: "access"` claim. Revoked tokens are rejected.
10. `POST /api/auth/refresh` rotates a refresh token: issues a new access/refresh pair, marks the old refresh token as replaced. If a previously-used refresh token is replayed (reuse detection), all refresh tokens for that user are revoked.
11. `POST /api/auth/logout` revokes the access token's JTI server-side (in-memory blocklist) and revokes all refresh tokens for the user.

### Chat message

1. Client `POST /api/messages` with `{ content, image_url?, channel_id? }`.
2. If `channel_id` is omitted, the backend resolves it to the default channel.
3. Handler enqueues DB write via `repository` (single-writer queue).
4. After write, `ws_manager.broadcast` sends `chat_message` (including `channel_id`) to all connected WebSocket clients.
5. Clients receive and render in real time; `use-chat.js` filters by active channel — messages for other channels increment unread counts instead.
6. Pagination: `GET /api/messages?limit=30&before=<uuid>&channel_id=<id>` fetches older pages on scroll-up.

### Channels

1. On WebSocket connect, `presence_init` includes a `channels` array — the full list of channels. `use-channels.js` populates state from this.
2. On HTTP boot, `use-channels.js` also fetches `GET /api/channels` as a fallback.
3. Admins/owners can create channels via `POST /api/channels` (name 1–40 chars, case-insensitive uniqueness, max 20 channels). On success, `channel_created` is broadcast to all WS clients.
4. Admins/owners can rename channels via `PATCH /api/channels/{id}` (not the default channel). On success, `channel_updated` is broadcast.
5. Admins/owners can delete channels via `DELETE /api/channels/{id}` (not the default channel). Deletion cascades: all messages in the channel are deleted first, then associated media files are removed from disk. On success, `channel_deleted` is broadcast; clients auto-switch to the default channel if the active channel was deleted.
6. Frontend tracks `activeChannelId` — switching channels clears unread count and re-fetches messages for the new channel. `use-chat.js` receives `activeChannelId` and filters/messages accordingly.
7. Desktop UI: horizontal tab bar with active highlight, right-click context menu for rename/delete, `+` button (admin only) opens a 7.css modal. Mobile UI: dropdown channel picker with create button.
8. Server admin panel: admins/owners can access a "Server Admin" button in the user profile modal that opens a Server Setup modal. The Channel Management tab lists all channels with delete capability (with confirmation); default channel is protected from deletion.

### Image upload

1. Client `POST /api/upload` with multipart file.
2. `api.upload.upload_file` delegates to `MediaValidator` (extension + magic-byte check) and `UploadStorage` (streamed write with size enforcement).
3. File saved to `uploads/` with a UUID filename.
4. Returns `{ url: "/uploads/<uuid>.<ext>" }`.
5. Client includes `image_url` in the subsequent `POST /api/messages`.
6. Background `MediaManager` picks up a typed `MessageMediaJob` and converts images to AVIF (scaled down to `MEDIA_IMAGE_MAX_DIMENSION`), videos to AV1/MP4 (scaled by `MEDIA_VIDEO_SCALE`), and GIFs to AV1/MP4 at original resolution (no scaling). After conversion the DB is updated and a `chat_message` WS broadcast replaces the placeholder URL.

### Avatar upload

1. Client `POST /api/avatar` with multipart file.
2. `api.upload.upload_avatar` delegates to `AvatarService`, which uses `MediaValidator` (JPEG/PNG/AVIF extension + magic-byte check), `UploadStorage` (streamed write, 1 MB limit), and `MediaManager` (enqueued as typed `AvatarJob` for AVIF conversion if not already AVIF).
3. Old avatar files for the user are deleted before the new one is saved.
4. DB updated with new avatar URL; `user_updated` WS broadcast to all clients.

### Voice

1. Client initializes live media config from `GET /api/livemediaconfig` (ICE servers, audio constraints) via `useLiveMediaConfig()`.
2. `useVoice.join()` (orchestrator) transitions through a state machine: `idle → joining → joined` (or back to `idle` on error).
3. On `joining`: acquire mic stream via `getUserMedia` (using constraints from `useLiveMediaConfig` and device from `useAudioPreferences`), then `POST /api/voice/join`. If the backend join succeeds but later setup (VAD, WebRTC offers) fails, the hook rolls back with `POST /api/voice/leave`.
4. `voice_participant_joined` broadcast to all WS clients.
5. Joiner sends SDP offers via `useVoiceMesh.sendOffersToParticipants()` — creates an `RTCPeerConnection` (mesh) to each existing participant through `createPeerMap()` from `webrtc-helpers.js`. SDP is munged via `voice-sdp.js` (`mungeOpusSdp`) to apply Opus bitrate/stereo settings.
6. Existing participants receive offers, create answers, and send them back via `voice_signal`.
7. Audio flows peer-to-peer (WebRTC). Backend only relays signaling messages, never audio data.
8. Remote audio routed through hidden DOM `<audio>` elements managed by `useVoiceMesh` (autoplay + `playsinline`). Chrome `NotAllowedError` retried on next user gesture. Per-user volume via `setVolume`.
9. `useVoiceParticipants` subscribes to WS events for participant lifecycle (join/leave), mute state, speaking state, and incoming voice signals — dispatching to `useVoiceMesh` for peer disposal and signal handling.
10. Mute toggle gates audio to peers via `RTCRtpSender.replaceTrack(null)` and sends `voice_mute` over WS; server broadcasts mute state to all clients, which renders a 🔇 icon next to the muted user in the participant list. Mute state resets on voice leave.
11. Client-side VAD uses `startVadMonitor()` (from `vad-monitor.js`) which creates an `AudioContext` + `AnalyserNode` on the local mic stream in a `requestAnimationFrame` loop. RMS volume is compared against a logarithmic sensitivity threshold (via `computeVadThreshold` — range `10⁻⁴` to `10⁻¹`). Sensitivity is read from `useAudioPreferences().prefsRef` (no localStorage reads in the hot loop). When speaking state changes (with rising/falling debounce), `onSpeakingChange` fires — in `useVoice` this gates audio to peers via `gateAudioToPeers()` and sends `voice_speaking` over WS. **When muted, speaking events are suppressed**: VAD still runs on real mic input, but `voice_speaking { speaking: true }` is never sent to peers and the local `isSpeaking` state stays false. Muting while already speaking immediately sends `voice_speaking { speaking: false }`. The receiving client updates a `speakingUsers` map (in `useVoiceParticipants`), which drives a green pulse ring animation on the speaking user's avatar. VAD sensitivity is adjustable via a slider in the profile modal; the modal runs its own `startVadMonitor` instance to show a live 🟢/🔴 indicator regardless of voice join state. Speaking state resets on voice leave.
12. `useVoice.leave()` transitions `joined → leaving → idle`, cleans up all peer connections/VAD/stream via the orchestrator's `cleanup()` (composing `disposeLocalVoice` + `disposeAllPeers` + `resetVoiceState`), then calls `POST /api/voice/leave`. `voice_participant_left` broadcast.

### Screen sharing

1. Sharer sends `screenshare_start` over WS → backend checks single-sharer constraint.
2. If allowed, broadcasts `screenshare_start` to all clients.
3. Viewers send `screenshare_request` → relayed to sharer.
4. Sharer creates WebRTC peer connection (via `createPeerMap`), sends SDP offer via `screenshare_signal`.
5. All signaling (offers, answers, ICE candidates) relayed through backend WS.
6. Media flows peer-to-peer (WebRTC). Backend never touches video/audio data.
7. `screenshare_stop` on disconnect or explicit stop; backend clears sharer state.

### Presence (online/offline)

1. When a client's WebSocket connects, the server sends `presence_init` with `{ user_ids }` — the full list of currently connected user IDs — to that client only.
2. The server broadcasts `presence_online` with `{ user_id }` to all other connected clients.
3. When a client's WebSocket disconnects, the server broadcasts `presence_offline` with `{ user_id }` to all remaining connected clients.
4. `use-chat.js` subscribes to presence events via `useRealtime()` and tracks `onlineUserIds` state from these events.
5. `MembersSidebar` displays all users from `usersMap`, grouped by online/offline, with green/gray status dots.
6. `GET /api/users` now includes an `online` boolean per user; `GET /api/users/online` returns just the online user IDs.

### Admin role management

1. The first registered user automatically receives `is_owner=True` and `is_admin=True` via `create_user()` in the repository.
2. On startup, `migrate_owner()` runs after `_migrate_columns()` — if no owner exists, the user with the earliest `created_at` is promoted to owner + admin.
3. Admins and the owner can promote/demote other users via `POST /api/users/{id}/admin` with `{ is_admin: true/false }`.
4. The server owner cannot be demoted (endpoint returns 403).
5. A user cannot modify their own admin status via this endpoint.
6. Role badges are displayed in the members sidebar: 👑 for owner, ⭐ for admin.
7. Admin status changes broadcast a `user_updated` WS event so all connected clients update in real time.

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

OpenAPI spec changes (`spec.yaml`) require a manual backend restart. Database migrations (new columns, new tables like `channels`) are applied automatically on boot via `_migrate_columns()` and `_migrate_indexes()` in `models.py`. A `migrate_default_channel()` call ensures a "general" default channel exists.

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
TRUST_PROXY=true
```

In production, frontend and backend share the same origin, so `CORS_ORIGIN` should match the public URL. CORS middleware is a no-op for same-origin requests.

**TLS is required for production.** Place a reverse proxy (nginx, Caddy, Traefik) in front with TLS termination. The backend adds security headers including HSTS by default. If you must run without TLS (local testing only), set `INSECURE_HTTP=true` to suppress the HSTS header.

### Persistent volumes

| Host Path | Container Path | Contents |
|-----------|----------------|----------|
| `./data/` | `/app/data` | SQLite DB (`microcord.db`), JWT secret (`.jwt_secret`) |
| `./uploads/` | `/app/uploads` | Uploaded images |

Both directories are gitignored. See README for backup/restore instructions.

---

## 10. Security

| Control | Implementation |
|---------|----------------|
| Auth always on | Every HTTP and WS request requires a valid JWT access token (WS via one-time ticket), except `/api/auth/*`, `/api/branding`, and `/uploads/*` |
| Identity from JWT | Author/user IDs derived from token, never from request bodies |
| IDOR protection | `PATCH /users/{id}` rejects modifications to other users; `DELETE /messages/{id}` rejects deletion of other users' messages |
| Admin authorization | `POST /users/{id}/admin` requires `is_admin` or `is_owner` in JWT; owner's admin status cannot be modified. Channel CRUD (`POST/PATCH/DELETE /api/channels`) requires admin/owner; default channel is protected from rename/delete |
| XSS sanitization | Chat markdown rendered with snarkdown, sanitized with DOMPurify |
| JWT algorithm pinning | Only HS256 accepted; `none` and others rejected |
| JWT validation | Issuer, audience, expiry, and `type: "access"` claim enforced on every decode |
| Token revocation | `POST /api/auth/logout` adds access JWT to in-memory blocklist and revokes refresh token; checked by `AuthMiddleware` |
| Refresh token rotation | Every refresh issues a new refresh token and invalidates the old one. Reuse detection revokes all refresh tokens for the user |
| Refresh token storage | SHA-256 hashed in DB; plaintext only returned once at creation |
| Rate limiting | In-memory with exponential backoff per endpoint: register (3/hr/IP, max 1h), login (5/min/IP, max 5m), messages (10/10s/user, max 1m), uploads (5/min/user, max 2m), refresh (10/min/IP, max 2m) |
| Registration passphrase | 6-digit hex uppercase secret required to register; auto-generated and logged on startup, override via `REGISTRATION_PASSPHRASE` env var |
| WS message size limit | Inbound WebSocket messages exceeding 64 KB are dropped |
| CORS lockdown | Restricted to `CORS_ORIGIN` (default `http://localhost:5173`) |
| Upload validation | File extension check + magic byte verification via `MediaValidator` (PNG/JPEG/GIF/WEBP/MP4/WEBM/MOV for uploads; JPEG/PNG/AVIF for avatars) |
| Upload size limits | Chat images: 50 MB (`MAX_UPLOAD_SIZE_BYTES`), avatars: 1 MB (`MAX_AVATAR_SIZE_BYTES`) |
| Image URL validation | Only `/uploads/`-prefixed URLs accepted in messages and avatars |
| Password storage | bcrypt hashing via `bcrypt >=4.0` |
| Single-writer DB | All mutations through asyncio queue in `repository` — prevents SQLite concurrent-write corruption |
| Security headers | `SecurityHeadersMiddleware` adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Content-Security-Policy`, and `Strict-Transport-Security` (HSTS, 2-year max-age). HSTS is omitted when `INSECURE_HTTP=true` |
| Proxy-aware rate limiting | When `TRUST_PROXY=true`, rate limiting reads `X-Forwarded-For` / `X-Real-IP` for client IP extraction |
| Non-root Docker | Both Dockerfiles create and use `appuser` for the process |
| JWT secret permissions | `.jwt_secret` file written with `0o600` permissions |
| Message length limit | `maxLength: 4000` enforced in OpenAPI spec for message content |
