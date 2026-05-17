# Microcord

Minimal self-hosted Discord-like app, with text chat, voice channels, and screen sharing, all in a lightweight process and ready for battle!

## Quick Start

```bash
docker compose up --build
```

Open **http://localhost:5173** — register an account and start chatting. The registration passphrase is printed in the backend logs on first boot.

## Features

- **Text chat** — markdown rendering, image uploads with inline preview, paginated history, multiple chat channels
- **Voice channel** — peer-to-peer WebRTC audio with per-user volume control
- **Screen sharing** — peer-to-peer WebRTC video + system audio, one sharer at a time
- **Real-time** — instant message broadcast via WebSocket
- **User profiles** — editable display name and avatar
- **Dark mode** — light/dark theme toggle, persisted per-browser, applied instantly on boot
- **Admin roles** — server owner (first registered account, cannot be demoted) and admins (promoted by any admin/owner via user list); role badges shown in members sidebar. Admins can create, rename, and delete chat channels
- **Resizable sidebars/separators** — drag to resize

## Architecture

Single-container Python app (Starlette + Connexion + SQLite) serving a Preact frontend. Voice and screen sharing use WebRTC mesh — audio and video flow peer-to-peer, the server only handles signaling.

```
Browser (Preact) ◄──REST/WS──► Starlette (Connexion + JWT) ──► SQLite
                  ◄───P2P───►  (WebRTC: voice + screenshare)
```

## Configuration

Set via environment variables or a `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *auto-generated* | HMAC secret (≥32 chars); saved to `data/.jwt_secret` |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin |
| `REGISTRATION_PASSPHRASE` | *auto-generated* | Secret required to register; logged on startup |

## Production

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Single container on port 8000 — serves the built frontend and API together. Persistent data in `./data/` (SQLite DB, JWT secret) and `./uploads/` (images). Use a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in production — the backend enforces HSTS by default.

## Docs

Full architecture, API reference, WebSocket protocol, data models, and deployment details are kept at [docs folder.](docs/repo-guide.md).

### License

MIT license.
