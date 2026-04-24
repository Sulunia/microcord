from constants import (
    ICE_SERVERS,
    VOICE_ECHO_CANCELLATION, VOICE_NOISE_SUPPRESSION, VOICE_AUTO_GAIN_CONTROL,
    VOICE_OPUS_BITRATE, VOICE_OPUS_STEREO,
    SCREENSHARE_WIDTH, SCREENSHARE_HEIGHT, SCREENSHARE_FRAME_RATE,
    MEDIA_AVIF_CRF, MEDIA_AV1_CRF, MEDIA_VIDEO_SCALE, MEDIA_VIDEO_MAX_BITRATE,
    MEDIA_FFMPEG_THREADS, MEDIA_IMAGE_MAX_DIMENSION,
    FFMPEG_TIMEOUT_SECONDS, FFMPEG_MEMORY_LIMIT_MB,
)


async def get_live_media_config() -> dict:
    return {
        "ice_servers": ICE_SERVERS,
        "audio": {
            "echo_cancellation": VOICE_ECHO_CANCELLATION,
            "noise_suppression": VOICE_NOISE_SUPPRESSION,
            "auto_gain_control": VOICE_AUTO_GAIN_CONTROL,
            "opus_bitrate": VOICE_OPUS_BITRATE,
            "opus_stereo": VOICE_OPUS_STEREO,
        },
        "screenshare": {
            "width": SCREENSHARE_WIDTH,
            "height": SCREENSHARE_HEIGHT,
            "frame_rate": SCREENSHARE_FRAME_RATE,
        },
        "media": {
            "avif_crf": MEDIA_AVIF_CRF,
            "av1_crf": MEDIA_AV1_CRF,
            "video_scale": MEDIA_VIDEO_SCALE,
            "video_max_bitrate": MEDIA_VIDEO_MAX_BITRATE,
            "ffmpeg_threads": MEDIA_FFMPEG_THREADS,
            "ffmpeg_timeout_seconds": FFMPEG_TIMEOUT_SECONDS,
            "ffmpeg_memory_limit_mb": FFMPEG_MEMORY_LIMIT_MB,
            "image_max_dimension": MEDIA_IMAGE_MAX_DIMENSION,
        },
    }
