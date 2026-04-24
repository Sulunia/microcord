import asyncio
import logging
import os
import resource
import subprocess

from constants import (
    MEDIA_AVIF_CRF, MEDIA_AV1_CRF, MEDIA_VIDEO_SCALE,
    MEDIA_VIDEO_MAX_BITRATE, MEDIA_FFMPEG_THREADS,
    FFMPEG_TIMEOUT_SECONDS, FFMPEG_MEMORY_LIMIT_MB,
    MEDIA_IMAGE_MAX_DIMENSION,
)
from database.repository import repo
from ws.manager import ws_manager

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
VIDEO_EXTENSIONS = {".gif", ".mp4", ".webm", ".mov"}


def _classify_media(ext: str) -> str | None:
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return None


class MediaManager:
    """Background worker that converts uploaded images and videos via ffmpeg.

    Accepts jobs through an async queue and processes them sequentially.
    Images are transcoded to AVIF; videos (and GIFs) are transcoded to
    AV1/MP4.  After conversion the DB is updated and connected WebSocket
    clients are notified.
    """

    def __init__(self):
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None

    def start(self):
        if self._queue is None:
            self._queue = asyncio.Queue()
        if self._task is None or self._task.done():
            self._task = asyncio.get_event_loop().create_task(self._worker_loop())
        return self._task

    async def enqueue(self, original_path: str, message_id: str, author_id: str):
        logger.debug(f"Enqueued message media job: msg={message_id} file={os.path.basename(original_path)}")
        await self._queue.put({
            "original_path": original_path,
            "message_id": message_id,
            "author_id": author_id,
        })

    async def enqueue_avatar(self, original_path: str, user_id: str):
        logger.debug(f"Enqueued avatar job: user={user_id} file={os.path.basename(original_path)}")
        await self._queue.put({
            "original_path": original_path,
            "user_id": user_id,
            "avatar": True,
        })

    async def _worker_loop(self):
        while True:
            job = await self._queue.get()
            try:
                if job.get("avatar"):
                    await self._process_avatar(job)
                else:
                    await self._process_message_media(job)
            except Exception:
                logger.exception("Media conversion job failed")
            finally:
                self._queue.task_done()

    async def _process_message_media(self, job: dict):
        original_path = job["original_path"]
        message_id = job["message_id"]
        author_id = job["author_id"]

        ext = os.path.splitext(original_path)[1].lower()
        media_type = _classify_media(ext)

        logger.debug(f"Processing message media: msg={message_id} ext={ext} type={media_type}")

        if media_type == "image":
            converted = await self._convert_image(original_path)
        elif media_type == "video":
            converted = await self._convert_video(original_path)
        else:
            logger.warning(f"Unknown media type for ext={ext}, skipping conversion")
            converted = None

        if converted:
            orig_size = os.path.getsize(original_path)
            new_size = os.path.getsize(converted)
            ratio = (1 - new_size / orig_size) * 100 if orig_size > 0 else 0
            logger.info(
                f"Converted {os.path.basename(original_path)} → {os.path.basename(converted)} "
                f"({self._fmt_size(orig_size)} → {self._fmt_size(new_size)}, {ratio:.1f}% smaller)"
            )
            new_url = f"/uploads/{os.path.basename(converted)}"
            try:
                os.remove(original_path)
            except OSError:
                logger.warning(f"Failed to delete original: {original_path}")
        else:
            new_url = f"/uploads/{os.path.basename(original_path)}"

        msg = await repo.update_message_image(message_id, new_url)
        if msg:
            await ws_manager.broadcast({"type": "chat_message", "data": msg.to_dict(include_author=True)})
        else:
            logger.warning(f"Message {message_id} not found for media update")

    async def _process_avatar(self, job: dict):
        original_path = job["original_path"]
        user_id = job["user_id"]

        ext = os.path.splitext(original_path)[1].lower()
        if ext == ".avif":
            logger.debug(f"Avatar already AVIF for user={user_id}, skipping conversion")
            return

        logger.debug(f"Processing avatar: user={user_id} ext={ext}")
        converted = await self._convert_image(original_path)

        if converted:
            orig_size = os.path.getsize(original_path)
            new_size = os.path.getsize(converted)
            ratio = (1 - new_size / orig_size) * 100 if orig_size > 0 else 0
            logger.info(
                f"Converted avatar {os.path.basename(original_path)} → {os.path.basename(converted)} "
                f"({self._fmt_size(orig_size)} → {self._fmt_size(new_size)}, {ratio:.1f}% smaller)"
            )
            new_url = f"/uploads/avatars/{os.path.basename(converted)}"
            try:
                os.remove(original_path)
            except OSError:
                logger.warning(f"Failed to delete original avatar: {original_path}")
        else:
            new_url = f"/uploads/avatars/{os.path.basename(original_path)}"

        user = await repo.update_user_avatar(user_id, new_url)
        if user:
            await ws_manager.broadcast({
                "type": "user_updated",
                "data": {"user_id": user_id, "user": user.to_dict()},
            })
        else:
            logger.warning(f"User {user_id} not found for avatar update")

    async def _convert_image(self, input_path: str) -> str | None:
        output_path = os.path.splitext(input_path)[0] + ".avif"
        cmd = [
            "ffmpeg", "-y", "-i", input_path,
        ]
        if MEDIA_IMAGE_MAX_DIMENSION > 0:
            cmd.extend(["-vf", f"scale='min({MEDIA_IMAGE_MAX_DIMENSION},iw)':'min({MEDIA_IMAGE_MAX_DIMENSION},ih)':force_original_aspect_ratio=decrease"])
        cmd.extend([
            "-c:v", "libaom-av1",
            "-crf", str(MEDIA_AVIF_CRF),
            "-cpu-used", "6",
            "-threads", str(MEDIA_FFMPEG_THREADS),
            "-frames:v", "1",
            output_path,
        ])
        return await self._run_ffmpeg(cmd, output_path)

    async def _convert_video(self, input_path: str) -> str | None:
        base = os.path.splitext(input_path)[0]
        output_path = base + "_av1.mp4"
        ext = os.path.splitext(input_path)[1].lower()
        is_gif = ext == ".gif"

        vf_filters = []
        if not is_gif and MEDIA_VIDEO_SCALE != 1.0:
            s = MEDIA_VIDEO_SCALE
            vf_filters.append(f"scale=trunc(iw*{s}/2)*2:trunc(ih*{s}/2)*2:flags=lanczos")

        cmd = [
            "ffmpeg", "-y", "-i", input_path,
        ]

        if vf_filters:
            cmd.extend(["-vf", ",".join(vf_filters)])

        cmd.extend([
            "-c:v", "libaom-av1",
            "-crf", str(MEDIA_AV1_CRF),
            "-cpu-used", "6",
            "-threads", str(MEDIA_FFMPEG_THREADS),
            "-tiles", "2x2",
            "-row-mt", "1",
        ])

        if MEDIA_VIDEO_MAX_BITRATE:
            cmd.extend(["-b:v", MEDIA_VIDEO_MAX_BITRATE, "-maxrate", MEDIA_VIDEO_MAX_BITRATE, "-bufsize", MEDIA_VIDEO_MAX_BITRATE])

        if is_gif:
            cmd.append("-an")
        else:
            cmd.extend(["-c:a", "libopus"])

        cmd.extend([
            "-movflags", "+faststart",
            output_path,
        ])
        return await self._run_ffmpeg(cmd, output_path)

    @staticmethod
    def _fmt_size(n: int) -> str:
        if n < 1024:
            return f"{n} B"
        if n < 1024 * 1024:
            return f"{n / 1024:.1f} KB"
        return f"{n / (1024 * 1024):.1f} MB"

    @staticmethod
    def _ffmpeg_preexec() -> None:
        mem_bytes = FFMPEG_MEMORY_LIMIT_MB * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))

    async def _run_ffmpeg(self, cmd: list[str], output_path: str) -> str | None:
        logger.debug(f"Running ffmpeg: {' '.join(cmd)}")
        loop = asyncio.get_event_loop()
        try:
            proc = await loop.run_in_executor(
                None,
                lambda: subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=FFMPEG_TIMEOUT_SECONDS,
                    preexec_fn=self._ffmpeg_preexec,
                ),
            )
            if proc.returncode == 0 and os.path.exists(output_path):
                return output_path
            if proc.returncode == -9:
                logger.error(f"ffmpeg OOM-killed (limit={FFMPEG_MEMORY_LIMIT_MB}MB) for {output_path}")
            else:
                logger.error(f"ffmpeg failed (rc={proc.returncode}): {proc.stderr if proc.stderr else 'no stderr'}")
            if os.path.exists(output_path):
                os.remove(output_path)
            return None
        except subprocess.TimeoutExpired:
            logger.error(f"ffmpeg timed out for {output_path}")
            return None
        except Exception:
            logger.exception("ffmpeg execution error")
            return None


media_manager = MediaManager()
