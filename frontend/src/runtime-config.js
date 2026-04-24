const config = {
    name: '🔊 Microcord',
    tagline: 'Microcord — a mini self-hostable chat app',
    voiceChannelName: 'Voice channel',
};

export async function initConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = await res.json();
        if (data.name) config.name = data.name;
        if (data.tagline) config.tagline = data.tagline;
        if (data.voice_channel_name) config.voiceChannelName = data.voice_channel_name;
    } catch {}
    document.title = config.name;
}

export default config;
