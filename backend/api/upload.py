import logging
import os
import uuid

from connexion.lifecycle import ConnexionResponse

from constants import UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES
from services.guard import guard
from services.utils.request_context import current_user_id
from services.utils.media_validator import media_validator
from services.utils.avatar_service import avatar_service
from services.utils.upload_storage import upload_storage

logger = logging.getLogger(__name__)


async def upload_file(file) -> ConnexionResponse:
    user_id = current_user_id()
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
    if not media_validator.validate_upload_extension(ext):
        return ConnexionResponse(status_code=400, body={"error": f"Invalid file type: {ext}"})

    filename = f"{uuid.uuid4().hex}{ext}"

    result = await upload_storage.stream_file(file, MAX_UPLOAD_SIZE_BYTES, UPLOAD_DIR, filename)
    if result is None:
        return ConnexionResponse(status_code=413, body={"error": "File too large"})

    first_bytes, filepath = result

    if not media_validator.validate_upload_magic(first_bytes, ext):
        os.remove(filepath)
        return ConnexionResponse(status_code=400, body={"error": "File contents do not match extension"})

    url = f"/uploads/{filename}"
    logger.info(f"File uploaded: {url}")
    return ConnexionResponse(status_code=201, body={"url": url})


async def upload_avatar(file) -> ConnexionResponse:
    user_id = current_user_id()
    if not user_id:
        return ConnexionResponse(status_code=401, body={"error": "Not authenticated"})

    return await avatar_service.upload_avatar(file, user_id)
