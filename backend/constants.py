import json
import os

DB_URL = "sqlite+aiosqlite:///data/microcord.db"
UPLOAD_DIR = "uploads"
MAX_UPLOAD_SIZE_BYTES = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "50")) * 1024 * 1024
MAX_AVATAR_SIZE_BYTES = 1 * 1024 * 1024
MEDIA_AVIF_CRF = int(os.environ.get("MEDIA_AVIF_CRF", "30"))
MEDIA_AV1_CRF = int(os.environ.get("MEDIA_AV1_CRF", "35"))
MEDIA_VIDEO_SCALE = float(os.environ.get("MEDIA_VIDEO_SCALE", "1.0"))
MEDIA_VIDEO_MAX_BITRATE = os.environ.get("MEDIA_VIDEO_MAX_BITRATE", "")
MEDIA_FFMPEG_THREADS = int(os.environ.get("MEDIA_FFMPEG_THREADS", "2"))
MEDIA_IMAGE_MAX_DIMENSION = int(os.environ.get("MEDIA_IMAGE_MAX_DIMENSION", "1920"))
DEFAULT_MESSAGE_LIMIT = 50
MAX_MESSAGE_LIMIT = 200
MAX_MESSAGE_CONTENT_LENGTH = 4000

AUTH_PROVIDER = os.environ.get("AUTH_PROVIDER", "local")
JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "microcord"
JWT_AUDIENCE = "microcord"
JWT_EXPIRY_HOURS = int(os.environ.get("JWT_EXPIRY_HOURS", "24"))
JWT_SECRET_MIN_LENGTH = 32
JWT_SECRET_FILE = "data/.jwt_secret"

CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "http://localhost:5173")

TRUST_PROXY = os.environ.get("TRUST_PROXY", "").lower() in ("1", "true", "yes")
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "1"))
INSECURE_HTTP = os.environ.get("INSECURE_HTTP", "").lower() in ("1", "true", "yes")

IMAGE_URL_PREFIX = "/uploads/"

MAX_WEBSOCKET_MESSAGE_SIZE = 65536

PASSWORD_MIN_LENGTH = 6
PASSWORD_MAX_LENGTH = 128
DISPLAY_NAME_MAX_LENGTH = 40
UPLOAD_CHUNK_SIZE = 64 * 1024
FFMPEG_TIMEOUT_SECONDS = 300
FFMPEG_MEMORY_LIMIT_MB = int(os.environ.get("FFMPEG_MEMORY_LIMIT_MB", "256"))

_ICE_SERVERS_DEFAULT = '[{"urls": "stun:stun.l.google.com:19302"}]'
ICE_SERVERS = json.loads(os.environ.get("ICE_SERVERS", _ICE_SERVERS_DEFAULT))

VOICE_ECHO_CANCELLATION = os.environ.get("VOICE_ECHO_CANCELLATION", "true").lower() in ("1", "true", "yes")
VOICE_NOISE_SUPPRESSION = os.environ.get("VOICE_NOISE_SUPPRESSION", "true").lower() in ("1", "true", "yes")
VOICE_AUTO_GAIN_CONTROL = os.environ.get("VOICE_AUTO_GAIN_CONTROL", "true").lower() in ("1", "true", "yes")
VOICE_OPUS_BITRATE = max(6000, min(510000, int(os.environ.get("VOICE_OPUS_BITRATE", "32000"))))
VOICE_OPUS_STEREO = os.environ.get("VOICE_OPUS_STEREO", "false").lower() in ("1", "true", "yes")
