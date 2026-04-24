const config = {
    name: '🔊 Microcord',
    voiceChannelName: 'Voice channel',
};

export async function initConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = await res.json();
        if (data.name) config.name = data.name;
        if (data.voice_channel_name) config.voiceChannelName = data.voice_channel_name;
    } catch {}
    document.title = config.name;
}

export default config;
