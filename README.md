# Microcord

Minimal self-hosted Discord-like app — text chat, voice channels, and screen sharing. No accounts services, no Redis, no Postgres. Just a single Python process and a SQLite file.

## Quick Start

```bash
docker compose up --build
```

Open **http://localhost:5173** — register an account and start chatting. The registration passphrase is printed in the backend logs on first boot.

## Features

- **Text chat** — markdown rendering, image and video uploads with inline preview, paginated history
- **Media transcoding** — images are auto-encoded to AVIF, animated GIFs to H.264 MP4 before upload, reducing bandwidth 60–95%. Configurable via `frontend/ui.config.js`.
- **Voice channel** — peer-to-peer WebRTC audio with per-user volume control
- **Screen sharing** — peer-to-peer WebRTC video + system audio, one sharer at a time
- **Real-time** — instant message broadcast via WebSocket
- **User profiles** — editable display name and avatar
- **Resizable sidebars/separators** — drag to resize
- **PWA** — installable as a standalone app on desktop and mobile

## Architecture

Single-container Python app (Starlette + Connexion + SQLite) serving a Preact frontend. Voice and screen sharing use WebRTC mesh — audio and video flow peer-to-peer, the server only handles signaling.

```
Browser (Preact) ◄──REST/WS──► Starlette (Connexion + JWT) ──► SQLite
                  ◄───P2P───►  (WebRTC: voice + screenshare)
```

Media uploads are transcoded client-side: images become AVIF, animated GIFs become H.264 MP4. The server only accepts the optimized formats — no server-side transcoding needed.

## Configuration

Set via environment variables or a `.env` file:

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *auto-generated* | HMAC secret (≥32 chars); saved to `data/.jwt_secret` |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin |
| `REGISTRATION_PASSPHRASE` | *auto-generated* | Secret required to register; logged on startup |

### Media transcoding config

Configured in `frontend/ui.config.js` under `mediaTranscode`:

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Enable client-side transcoding |
| `maxImageInputBytes` | 14 MB | Max image input when enabled |
| `maxVideoInputBytes` | 70 MB | Max video/GIF input when enabled |
| `maxOutputBytes` | 50 MB | Hard server ceiling (always enforced) |
| `avifQuality` | 60 | AVIF encoding quality (0–100) |
| `h264Bitrate` | 2 Mbps | H.264 video bitrate |

When disabled, a single 50 MB cap applies to all uploads.

## Hosting behind CGNAT / Cloudflare Tunnel

Microcord works behind Cloudflare Tunnel — API requests and WebSocket connections pass through `cloudflared` out of the box. Note that Cloudflare's ToS §2.8 discourages disproportionate non-HTML binary serving on free/Pro plans; sustained high-volume media traffic can trigger rate-limits.

The built-in media transcoding is the primary defense: all images are encoded to AVIF and animated GIFs to H.264 MP4, typically achieving 60–95% size reduction before bytes ever reach the tunnel. This keeps bandwidth usage well within CF's informal thresholds for small-team or personal use.

## Production

```bash
docker compose -f docker-compose.prod.yml up --build -d
```

Single container on port 8000 — serves the built frontend and API together. Persistent data in `./data/` (SQLite DB, JWT secret) and `./uploads/` (images and video-GIFs).

## Docs

Full architecture, API reference, WebSocket protocol, data models, and deployment details are kept at [docs folder.](docs/repo-guide.md).

### License

MIT license.
