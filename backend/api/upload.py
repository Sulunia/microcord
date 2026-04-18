import os
import uuid
import base64
import logging
import asyncio
from connexion.lifecycle import ConnexionResponse
from connexion import request as connexion_request
from sqlalchemy import select
from constants import UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, MAX_AVATAR_SIZE_BYTES
from models.user import User
from models.base import get_read_session
from services.db_writer import enqueue_write
from services.guard import guard
from ws.manager import ws_manager

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}

MAGIC_BYTES = {
    b"\x89PNG": {".png"},
    b"\xff\xd8\xff": {".jpg", ".jpeg"},
    b"GIF8": {".gif"},
}

WEBP_MAGIC = b"RIFF"
WEBP_SIGNATURE = b"WEBP"

AVATAR_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".avif"}

AVATAR_EXT_TO_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".avif": "image/avif",
}

AVATAR_DIR = os.path.join(UPLOAD_DIR, "avatars")


def _validate_magic(contents: bytes, ext: str) -> bool:
    for magic, exts in MAGIC_BYTES.items():
        if contents[:len(magic)] == magic:
            return ext in exts
    if ext == ".webp" and len(contents) >= 12:
        return contents[:4] == WEBP_MAGIC and contents[8:12] == WEBP_SIGNATURE
    return False


def _validate_avatar_magic(contents: bytes, ext: str) -> bool:
    if ext in {".jpg", ".jpeg"} and contents[:3] == b"\xff\xd8\xff":
        return True
    if ext == ".png" and contents[:4] == b"\x89PNG":
        return True
    if ext == ".avif" and len(contents) >= 12 and contents[4:12] == b"ftypavif":
        return True
    return False


def _get_current_user_id() -> str | None:
    try:
        scope = connexion_request.scope
        return scope.get("state", {}).get("current_user", {}).get("id")
    except Exception:
        return None


async def _read_file(file) -> bytes:
    result = file.read()
    return (await result) if asyncio.iscoroutine(result) else result


def _delete_old_avatar(user_id: str):
    if not os.path.isdir(AVATAR_DIR):
        return
    for ext in AVATAR_ALLOWED_EXTENSIONS:
        path = os.path.join(AVATAR_DIR, f"{user_id}{ext}")
        if os.path.exists(path):
            os.remove(path)


async def upload_file(file) -> ConnexionResponse:
    user_id = _get_current_user_id()
    if user_id:
        rl = guard.check_upload(user_id)
        if rl is not None:
            return ConnexionResponse(
                status_code=429,
                body={"error": f"Too many uploads. Try again in {int(rl)} seconds."},
            )

    if not file or not file.filename:
        return ConnexionResponse(status_code=400, body={"error": "No file provided"})

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return ConnexionResponse(status_code=400, body={"error": f"Invalid file type: {ext}"})

    contents = await _read_file(file)
    if len(contents) > MAX_UPLOAD_SIZE_BYTES:
        return ConnexionResponse(status_code=413, body={"error": "File too large"})

    if not _validate_magic(contents, ext):
        return ConnexionResponse(status_code=400, body={"error": "File contents do not match extension"})

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(contents)

    url = f"/uploads/{filename}"
    logger.info(f"File uploaded: {url}")
    return ConnexionResponse(status_code=201, body={"url": url})


async def upload_avatar(file) -> ConnexionResponse:
    user_id = _get_current_user_id()
    if not user_id:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})

    rl = guard.check_upload(user_id)
    if rl is not None:
        return ConnexionResponse(
            status_code=429,
            body={"error": f"Too many uploads. Try again in {int(rl)} seconds."},
        )

    if not file or not file.filename:
        return ConnexionResponse(status_code=400, body={"error": "No file provided"})

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in AVATAR_ALLOWED_EXTENSIONS:
        return ConnexionResponse(
            status_code=400,
            body={"error": f"Invalid file type: {ext}. Allowed: JPEG, PNG, AVIF"},
        )

    contents = await _read_file(file)
    if len(contents) > MAX_AVATAR_SIZE_BYTES:
        return ConnexionResponse(status_code=413, body={"error": "File too large (max 1 MB)"})

    if not _validate_avatar_magic(contents, ext):
        return ConnexionResponse(status_code=400, body={"error": "File contents do not match extension"})

    os.makedirs(AVATAR_DIR, exist_ok=True)
    _delete_old_avatar(user_id)

    filename = f"{user_id}{ext}"
    filepath = os.path.join(AVATAR_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    avatar_url = f"/uploads/avatars/{filename}"

    async def _write(session):
        result = await session.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            return None
        user.avatar_url = avatar_url
        await session.flush()
        await session.refresh(user)
        return user.to_dict()

    result = await enqueue_write(_write)
    if result is None:
        return ConnexionResponse(status_code=404, body={"error": "User not found"})

    await ws_manager.broadcast({
        "type": "user_updated",
        "data": {"user_id": user_id, "user": result},
    })

    logger.info(f"Avatar updated for user {user_id}")
    return ConnexionResponse(status_code=200, body=result)
