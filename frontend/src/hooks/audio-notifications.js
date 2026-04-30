const cache = new Map();

function getOrCreate(url, volume) {
    let entry = cache.get(url);
    if (!entry) {
        const audio = new Audio(url);
        audio.volume = volume;
        entry = audio;
        cache.set(url, entry);
    }
    return entry;
}

/**
 * Play a notification sound from `/sounds/`.
 *
 * @param {string} url  — e.g. `'/sounds/EnterVoice.wav'`
 * @param {number} [volume=0.7] — 0…1
 */
export function playNotification(url, volume = 0.7) {
    const audio = getOrCreate(url, volume);
    audio.volume = volume;
    audio.currentTime = 0;
    audio.play().catch(() => {});
}

export const SOUND_ENTER_VOICE = '/sounds/EnterVoice.wav';
export const SOUND_EXIT_VOICE = '/sounds/ExitVoice.wav';
