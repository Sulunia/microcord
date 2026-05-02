import asyncio
import logging
import os

from connexion import request as connexion_request

from constants import UPLOAD_CHUNK_SIZE

logger = logging.getLogger(__name__)


class UploadStorage:
    """Streams uploaded files to disk through a temp file, enforcing size limits."""

    async def stream_file(self, file, max_bytes: int, dest_dir: str, dest_filename: str) -> tuple[bytes, str] | None:
        content_length = connexion_request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > max_bytes:
                    return None
            except ValueError:
                pass

        chunk_size = UPLOAD_CHUNK_SIZE
        first_bytes = b""
        total = 0

        os.makedirs(dest_dir, exist_ok=True)
        dest_path = os.path.join(dest_dir, dest_filename)
        tmp_path = dest_path + ".tmp"

        try:
            with open(tmp_path, "wb") as f:
                while True:
                    chunk = file.read(chunk_size)
                    if asyncio.iscoroutine(chunk):
                        chunk = await chunk
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > max_bytes:
                        os.remove(tmp_path)
                        return None
                    if not first_bytes:
                        first_bytes = chunk
                    f.write(chunk)
            os.rename(tmp_path, dest_path)
            return first_bytes, dest_path
        except Exception:
            logger.exception(f"Failed to stream file to {dest_path}")
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise


upload_storage = UploadStorage()
