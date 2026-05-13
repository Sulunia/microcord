import { TICK_SOUNDS, SOUND_ENTER_VOICE, SOUND_EXIT_VOICE, NOTIFICATION_VOLUME, VOICE_EXIT_VOLUME } from '../constants.js';

const cache = new Map();

function preload(url, volume) {
    if (cache.has(url)) return cache.get(url);
    const audio = new Audio(url);
    audio.volume = volume;
    audio.preload = 'auto';
    cache.set(url, audio);
    return audio;
}

preload(SOUND_ENTER_VOICE, NOTIFICATION_VOLUME);
preload(SOUND_EXIT_VOICE, VOICE_EXIT_VOLUME);
TICK_SOUNDS.forEach((t) => preload(t.url, NOTIFICATION_VOLUME));

/**
 * Play a cached notification sound.
 *
 * @param {string} url  — e.g. `'/sounds/EnterVoice.wav'`
 * @param {number} [volume=0.7] — 0…1
 */
export function playNotification(url, volume = NOTIFICATION_VOLUME) {
    const audio = preload(url, volume);
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
}

export function tickUrl(id) {
    const s = TICK_SOUNDS.find((t) => t.id === id);
    return s ? s.url : TICK_SOUNDS[0].url;
}
