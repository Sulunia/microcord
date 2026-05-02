import logging

logger = logging.getLogger(__name__)

UPLOAD_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm", ".mov"}

UPLOAD_MAGIC_BYTES = {
    b"\x89PNG": {".png"},
    b"\xff\xd8\xff": {".jpg", ".jpeg"},
    b"GIF8": {".gif"},
    b"\x00\x00\x00": {".mp4", ".mov"},
    b"\x1a\x45\xdf\xa5": {".webm"},
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


class MediaValidator:
    """File-type validation via extension whitelists and magic-byte inspection."""

    def validate_upload_extension(self, ext: str) -> bool:
        return ext in UPLOAD_ALLOWED_EXTENSIONS

    def validate_upload_magic(self, contents: bytes, ext: str) -> bool:
        if ext in {".mp4", ".mov"}:
            return len(contents) >= 8 and contents[4:8] == b"ftyp"
        if ext == ".webp" and len(contents) >= 12:
            return contents[:4] == WEBP_MAGIC and contents[8:12] == WEBP_SIGNATURE
        for magic, exts in UPLOAD_MAGIC_BYTES.items():
            if contents[:len(magic)] == magic:
                return ext in exts
        return False

    def validate_avatar_extension(self, ext: str) -> bool:
        return ext in AVATAR_ALLOWED_EXTENSIONS

    def validate_avatar_magic(self, contents: bytes, ext: str) -> bool:
        if ext in {".jpg", ".jpeg"} and contents[:3] == b"\xff\xd8\xff":
            return True
        if ext == ".png" and contents[:4] == b"\x89PNG":
            return True
        if ext == ".avif" and len(contents) >= 12 and contents[4:12] == b"ftypavif":
            return True
        return False


media_validator = MediaValidator()
