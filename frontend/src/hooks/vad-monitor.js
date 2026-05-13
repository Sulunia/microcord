import { VAD_RISING_DEBOUNCE_MS, VAD_FALLING_DEBOUNCE_MS } from '../constants.js';

/**
 * Convert a 1–100 sensitivity slider value to an RMS threshold.
 * Higher sensitivity → lower threshold → easier to trigger speaking.
 *
 * @param {number} sensitivity — slider value (1–100, default 50)
 * @returns {number} RMS threshold in the range 10⁻⁴ … 10⁻¹
 */
export function computeVadThreshold(sensitivity) {
    const clamped = Math.max(1, Math.min(100, sensitivity));
    return Math.pow(10, -4 + Math.sqrt((100 - clamped) / 99) * 3);
}

/**
 * Start a VAD (voice-activity detection) monitor on the given MediaStream.
 *
 * Uses RMS energy on an AnalyserNode and calls `onSpeakingChange(boolean)`
 * when the detected state changes, with configurable rising/falling debounce.
 *
 * @param {MediaStream} stream
 * @param {object} options
 * @param {(now: number) => number} [options.getThreshold]
 *   Called each frame with `performance.now()`.  Return the RMS threshold.
 *   If omitted the sensitivity is read from `prefsRef.current.vadSensitivity`
 *   (provided by `useAudioPreferences`).
 * @param {import('preact/hooks').MutableRef<{ vadSensitivity: number }>} [options.prefsRef]
 *   Required when `getThreshold` is omitted.
 * @param {(speaking: boolean) => void} options.onSpeakingChange
 *   Called when speaking state toggles.
 * @param {number} [options.risingDebounceMs=22]
 * @param {number} [options.fallingDebounceMs=180]
 * @returns {{ stop: () => void }}
 *   Call `stop()` to tear down the AudioContext and cancel the RAF loop.
 */
export function startVadMonitor(stream, options) {
    const {
        prefsRef,
        getThreshold,
        onSpeakingChange,
        risingDebounceMs = VAD_RISING_DEBOUNCE_MS,
        fallingDebounceMs = VAD_FALLING_DEBOUNCE_MS,
    } = options;

    let speaking = false;
    let lastChange = 0;
    let rafId = null;
    let stopped = false;
    let currentSensitivity = prefsRef?.current?.vadSensitivity ?? 50;

    const onSensitivityChange = (e) => {
        currentSensitivity = e.detail;
    };
    window.addEventListener('vad-sensitivity-change', onSensitivityChange);

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const data = new Uint8Array(analyser.fftSize);

    function resolveThreshold(now) {
        if (getThreshold) return getThreshold(now);
        return computeVadThreshold(currentSensitivity);
    }

    const tick = () => {
        if (stopped) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const sample = (data[i] - 128) / 128;
            sum += sample * sample;
        }
        const rms = Math.sqrt(sum / data.length);
        const threshold = resolveThreshold(performance.now());
        const now = performance.now();
        const loud = rms > threshold;

        if (loud !== speaking) {
            const debounceMs = loud && !speaking ? risingDebounceMs : fallingDebounceMs;
            if (now - lastChange >= debounceMs) {
                speaking = loud;
                lastChange = now;
                onSpeakingChange(speaking);
            }
        } else {
            lastChange = now;
        }

        rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return {
        stop() {
            stopped = true;
            window.removeEventListener('vad-sensitivity-change', onSensitivityChange);
            if (rafId) cancelAnimationFrame(rafId);
            audioCtx.close().catch(() => {});
        },
    };
}
