import logging
import os
import uuid

from connexion.lifecycle import ConnexionResponse

from constants import MAX_AVATAR_SIZE_BYTES, UPLOAD_DIR
from database.repository import repo
from services.guard import guard
from services.media_manager import media_manager
from services.utils.media_validator import media_validator, AVATAR_ALLOWED_EXTENSIONS
from services.utils.upload_storage import upload_storage
from ws.manager import ws_manager

logger = logging.getLogger(__name__)

AVATAR_DIR = os.path.join(UPLOAD_DIR, "avatars")


class AvatarService:
    """Avatar upload lifecycle: validation, storage, old-file cleanup, DB update, and WS broadcast."""

    def delete_old_avatar(self, user_id: str):
        if not os.path.isdir(AVATAR_DIR):
            return
        prefix = f"{user_id}_"
        for entry in os.listdir(AVATAR_DIR):
            name, dot_ext = os.path.splitext(entry)
            if name.startswith(prefix) and dot_ext.lower() in AVATAR_ALLOWED_EXTENSIONS:
                os.remove(os.path.join(AVATAR_DIR, entry))

    async def upload_avatar(self, file, user_id: str) -> ConnexionResponse:
        rl = guard.check_upload(user_id)
        if rl is not None:
            return ConnexionResponse(
                status_code=429,
                body={"error": f"Too many uploads. Try again in {int(rl)} seconds."},
            )

        if not file or not file.filename:
            return ConnexionResponse(status_code=400, body={"error": "No file provided"})

        ext = os.path.splitext(file.filename)[1].lower()
        if not media_validator.validate_avatar_extension(ext):
            return ConnexionResponse(
                status_code=400,
                body={"error": f"Invalid file type: {ext}. Allowed: JPEG, PNG, AVIF"},
            )

        self.delete_old_avatar(user_id)
        filename = f"{user_id}_{uuid.uuid4().hex}{ext}"

        result = await upload_storage.stream_file(file, MAX_AVATAR_SIZE_BYTES, AVATAR_DIR, filename)
        if result is None:
            return ConnexionResponse(status_code=413, body={"error": "File too large (max 1 MB)"})

        first_bytes, filepath = result

        if not media_validator.validate_avatar_magic(first_bytes, ext):
            os.remove(filepath)
            return ConnexionResponse(status_code=400, body={"error": "File contents do not match extension"})

        avatar_url = f"/uploads/avatars/{filename}"

        if ext != ".avif":
            await media_manager.enqueue_avatar(filepath, user_id)

        user = await repo.update_user_avatar(user_id, avatar_url)
        if user is None:
            return ConnexionResponse(status_code=404, body={"error": "User not found"})

        result = user.to_dict()
        await ws_manager.broadcast({
            "type": "user_updated",
            "data": {"user_id": user_id, "user": user.to_public_dict()},
        })

        logger.info(f"Avatar updated for user {user_id}")
        return ConnexionResponse(status_code=200, body=result)


avatar_service = AvatarService()
