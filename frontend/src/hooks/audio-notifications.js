import { TICK_SOUNDS, SOUND_ENTER_VOICE, SOUND_EXIT_VOICE } from '../constants.js';

const cache = new Map();

function preload(url, volume) {
    if (cache.has(url)) return cache.get(url);
    const audio = new Audio(url);
    audio.volume = volume;
    audio.preload = 'auto';
    cache.set(url, audio);
    return audio;
}

preload(SOUND_ENTER_VOICE, 0.7);
preload(SOUND_EXIT_VOICE, 0.55);
TICK_SOUNDS.forEach((t) => preload(t.url, 0.7));

/**
 * Play a cached notification sound.
 *
 * @param {string} url  — e.g. `'/sounds/EnterVoice.wav'`
 * @param {number} [volume=0.7] — 0…1
 */
export function playNotification(url, volume = 0.7) {
    const audio = preload(url, volume);
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
}

export function tickUrl(id) {
    const s = TICK_SOUNDS.find((t) => t.id === id);
    return s ? s.url : TICK_SOUNDS[0].url;
}
