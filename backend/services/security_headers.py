import logging
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.responses import Response

from constants import INSECURE_HTTP

logger = logging.getLogger(__name__)

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
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
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Permissions-Policy": (
        "accelerometer=(), autoplay=(self), camera=(), display-capture=(self), "
        "encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), "
        "keyboard-map=(), magnetometer=(), microphone=(self), midi=(), "
        "payment=(), picture-in-picture=(), publickey-credentials-get=(), "
        "screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), "
        "xr-spatial-tracking=(), clipboard-read=(), clipboard-write=(), "
        "gamepad=(), hid=(), idle-detection=(), serial=()"
    ),
}

_HSTS_HEADER = {"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload"}


class SecurityHeadersMiddleware:
    """Injects OWASP-recommended security response headers into every HTTP response.

    Includes HSTS when ``INSECURE_HTTP`` is not set.  See
    https://owasp.org/www-project-secure-headers/ for the full reference.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        if INSECURE_HTTP:
            logger.warning(
                "INSECURE_HTTP is enabled — HSTS and security best-practice enforcement are disabled. "
                "Do NOT use this in production without a TLS-terminating reverse proxy."
            )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        _STRIPPED = {b"server"}

        async def send_with_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (n, v) for n, v in message.get("headers", [])
                    if n.lower() not in _STRIPPED
                ]
                for name, value in _SECURITY_HEADERS.items():
                    headers.append((name.encode("latin-1"), value.encode("latin-1")))
                if not INSECURE_HTTP:
                    for name, value in _HSTS_HEADER.items():
                        headers.append((name.encode("latin-1"), value.encode("latin-1")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
