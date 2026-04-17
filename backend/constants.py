import json
import os

DB_URL = "sqlite+aiosqlite:///data/microcord.db"
UPLOAD_DIR = "uploads"
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024
MAX_AVATAR_SIZE_BYTES = 1 * 1024 * 1024
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

IMAGE_URL_PREFIX = "/uploads/"

MAX_WEBSOCKET_MESSAGE_SIZE = 65536

_ICE_SERVERS_DEFAULT = '[{"urls": "stun:stun.l.google.com:19302"}]'
ICE_SERVERS = json.loads(os.environ.get("ICE_SERVERS", _ICE_SERVERS_DEFAULT))
