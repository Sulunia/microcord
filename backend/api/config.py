from constants import APP_NAME, APP_TAGLINE, VOICE_CHANNEL_NAME


async def get_config() -> dict:
    return {
        "name": APP_NAME,
        "tagline": APP_TAGLINE,
        "voice_channel_name": VOICE_CHANNEL_NAME,
    }
