import { useState, useEffect, useRef } from 'preact/hooks';
import { LIVE_MEDIA_CONFIG, initLiveMediaConfig } from '../constants.js';

const FALLBACK_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const FALLBACK_AUDIO_CONFIG = {
    echo_cancellation: true,
    noise_suppression: true,
    auto_gain_control: true,
    opus_bitrate: 32000,
    opus_stereo: false,
};

/**
 * Hook that initialises `LIVE_MEDIA_CONFIG` once and exposes reactive
 * slices for ICE servers and audio config.
 *
 * @returns {{
 *   ready: boolean,
 *   iceServers: RTCIceServer[],
 *   audioConfig: object,
 *   screenshareConfig: object,
 * }}
 */
export function useLiveMediaConfig() {
    const [ready, setReady] = useState(false);
    const iceRef = useRef(FALLBACK_ICE_SERVERS);
    const audioRef = useRef(FALLBACK_AUDIO_CONFIG);
    const screenshareRef = useRef(LIVE_MEDIA_CONFIG.screenshare);

    useEffect(() => {
        let cancelled = false;
        initLiveMediaConfig().then(() => {
            if (cancelled) return;
            iceRef.current = LIVE_MEDIA_CONFIG.iceServers;
            audioRef.current = LIVE_MEDIA_CONFIG.audio;
            screenshareRef.current = LIVE_MEDIA_CONFIG.screenshare;
            setReady(true);
        });
        return () => { cancelled = true; };
    }, []);

    return {
        ready,
        get iceServers() { return iceRef.current; },
        get audioConfig() { return audioRef.current; },
        get screenshareConfig() { return screenshareRef.current; },
    };
}
