import { authedFetch } from './hooks/use-user.js';

const API_BASE = '/api';

const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    audio: {
        echo_cancellation: true,
        noise_suppression: true,
        auto_gain_control: true,
        opus_bitrate: 32000,
        opus_stereo: false,
    },
    screenshare: {
        width: 1920,
        height: 1080,
        frameRate: 60,
    },
    media: {
        avif_crf: 30,
        av1_crf: 35,
        video_scale: 1.0,
        video_max_bitrate: '',
        ffmpeg_threads: 2,
        ffmpeg_timeout_seconds: 300,
        ffmpeg_memory_limit_mb: 256,
        image_max_dimension: 1920,
    },
};

let _initPromise = null;

export async function initLiveMediaConfig() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        try {
            const res = await authedFetch(`${API_BASE}/livemediaconfig`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.ice_servers) config.iceServers = data.ice_servers;
            if (data.audio) config.audio = { ...config.audio, ...data.audio };
            if (data.screenshare) {
                if (data.screenshare.width) config.screenshare.width = data.screenshare.width;
                if (data.screenshare.height) config.screenshare.height = data.screenshare.height;
                if (data.screenshare.frame_rate) config.screenshare.frameRate = data.screenshare.frame_rate;
            }
            if (data.media) config.media = { ...config.media, ...data.media };
        } catch {}
    })();
    return _initPromise;
}

export default config;
