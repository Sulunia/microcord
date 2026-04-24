from constants import APP_NAME, VOICE_CHANNEL_NAME


async def get_config() -> dict:
    return {
        "name": APP_NAME,
        "voice_channel_name": VOICE_CHANNEL_NAME,
    }
