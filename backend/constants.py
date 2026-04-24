import json
import os


def _env(key, default):
    val = os.environ.get(key, "")
    return val if val else default


def _env_int(key, default):
    val = os.environ.get(key, "")
    return int(val) if val else default


def _env_float(key, default):
    val = os.environ.get(key, "")
    return float(val) if val else default


DB_URL = "sqlite+aiosqlite:///data/microcord.db"
UPLOAD_DIR = "uploads"
MAX_UPLOAD_SIZE_BYTES = _env_int("MAX_UPLOAD_SIZE_MB", 50) * 1024 * 1024
MAX_AVATAR_SIZE_BYTES = 1 * 1024 * 1024
MEDIA_AVIF_CRF = _env_int("MEDIA_AVIF_CRF", 30)
MEDIA_AV1_CRF = _env_int("MEDIA_AV1_CRF", 35)
MEDIA_VIDEO_SCALE = _env_float("MEDIA_VIDEO_SCALE", 1.0)
MEDIA_VIDEO_MAX_BITRATE = _env("MEDIA_VIDEO_MAX_BITRATE", "")
MEDIA_FFMPEG_THREADS = _env_int("MEDIA_FFMPEG_THREADS", 2)
MEDIA_IMAGE_MAX_DIMENSION = _env_int("MEDIA_IMAGE_MAX_DIMENSION", 1920)
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 200
MAX_MESSAGE_CONTENT_LENGTH = 4000

AUTH_PROVIDER = _env("AUTH_PROVIDER", "local")
JWT_SECRET = _env("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "microcord"
JWT_AUDIENCE = "microcord"
JWT_EXPIRY_HOURS = _env_int("JWT_EXPIRY_HOURS", 24)
JWT_SECRET_MIN_LENGTH = 32
JWT_SECRET_FILE = "data/.jwt_secret"

CORS_ORIGIN = _env("CORS_ORIGIN", "http://localhost:5173")

TRUST_PROXY = _env("TRUST_PROXY", "").lower() in ("1", "true", "yes")
TRUSTED_PROXY_HOPS = _env_int("TRUSTED_PROXY_HOPS", 1)
INSECURE_HTTP = _env("INSECURE_HTTP", "").lower() in ("1", "true", "yes")

IMAGE_URL_PREFIX = "/uploads/"

MAX_WEBSOCKET_MESSAGE_SIZE = 65536

PASSWORD_MIN_LENGTH = 6
PASSWORD_MAX_LENGTH = 128
DISPLAY_NAME_MAX_LENGTH = 40
UPLOAD_CHUNK_SIZE = 64 * 1024
FFMPEG_TIMEOUT_SECONDS = 300
FFMPEG_MEMORY_LIMIT_MB = _env_int("FFMPEG_MEMORY_LIMIT_MB", 256)

_ICE_SERVERS_DEFAULT = '[{"urls": "stun:stun.l.google.com:19302"}]'
ICE_SERVERS = json.loads(_env("ICE_SERVERS", _ICE_SERVERS_DEFAULT))

VOICE_ECHO_CANCELLATION = _env("VOICE_ECHO_CANCELLATION", "true").lower() in ("1", "true", "yes")
VOICE_NOISE_SUPPRESSION = _env("VOICE_NOISE_SUPPRESSION", "true").lower() in ("1", "true", "yes")
VOICE_AUTO_GAIN_CONTROL = _env("VOICE_AUTO_GAIN_CONTROL", "true").lower() in ("1", "true", "yes")
VOICE_OPUS_BITRATE = max(6000, min(510000, _env_int("VOICE_OPUS_BITRATE", 32000)))
VOICE_OPUS_STEREO = _env("VOICE_OPUS_STEREO", "false").lower() in ("1", "true", "yes")

APP_NAME = _env("APP_NAME", "\U0001f50a Microcord")
APP_TAGLINE = _env("APP_TAGLINE", "Microcord \u2014 a mini self-hostable chat app")
VOICE_CHANNEL_NAME = _env("VOICE_CHANNEL_NAME", "Voice channel")
SCREENSHARE_WIDTH = _env_int("SCREENSHARE_WIDTH", 1920)
SCREENSHARE_HEIGHT = _env_int("SCREENSHARE_HEIGHT", 1080)
SCREENSHARE_FRAME_RATE = _env_int("SCREENSHARE_FRAME_RATE", 60)
