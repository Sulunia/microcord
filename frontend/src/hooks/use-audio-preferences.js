import { useState, useCallback, useRef } from 'preact/hooks';
import {
    AUDIO_INPUT_KEY,
    AUDIO_OUTPUT_KEY,
    VAD_SENSITIVITY_KEY,
    ECHO_CANCELLATION_KEY,
    NOISE_SUPPRESSION_KEY,
    AUTO_GAIN_CONTROL_KEY,
    RNNOISE_KEY,
} from '../constants.js';
import { useLatest } from './use-latest.js';

const readBool = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
};

/**
 * Reactive audio preferences backed by localStorage.
 *
 * Returns the current values plus setters that write through to
 * localStorage so other tabs / hooks pick up changes.  A `prefsRef`
 * is also exposed for reading the latest values inside animation-frame
 * loops without stale closures.
 */
export function useAudioPreferences() {
    const [inputDevice, setInputDevice] = useState(() => localStorage.getItem(AUDIO_INPUT_KEY) || '');
    const [outputDevice, setOutputDevice] = useState(() => localStorage.getItem(AUDIO_OUTPUT_KEY) || '');
    const [vadSensitivity, setVadSensitivityRaw] = useState(
        () => parseInt(localStorage.getItem(VAD_SENSITIVITY_KEY), 10) || 50,
    );
    const [echoCancellation, setEchoCancellationState] = useState(
        () => readBool(ECHO_CANCELLATION_KEY, true),
    );
    const [noiseSuppression, setNoiseSuppressionState] = useState(
        () => readBool(NOISE_SUPPRESSION_KEY, true),
    );
    const [autoGainControl, setAutoGainControlState] = useState(
        () => readBool(AUTO_GAIN_CONTROL_KEY, true),
    );
    const [rnnoiseEnabled, setRnnoiseState] = useState(
        () => readBool(RNNOISE_KEY, true),
    );

    const prefsRef = useLatest({ inputDevice, outputDevice, vadSensitivity, echoCancellation, noiseSuppression, autoGainControl, rnnoiseEnabled });

    const setInput = useCallback((deviceId) => {
        localStorage.setItem(AUDIO_INPUT_KEY, deviceId);
        setInputDevice(deviceId);
    }, []);

    const setOutput = useCallback((deviceId) => {
        localStorage.setItem(AUDIO_OUTPUT_KEY, deviceId);
        setOutputDevice(deviceId);
    }, []);

    const setVadSensitivity = useCallback((value) => {
        const clamped = Math.max(1, Math.min(100, value));
        localStorage.setItem(VAD_SENSITIVITY_KEY, String(clamped));
        setVadSensitivityRaw(clamped);
        window.dispatchEvent(new CustomEvent('vad-sensitivity-change', { detail: clamped }));
    }, []);

    const setEchoCancellation = useCallback((value) => {
        localStorage.setItem(ECHO_CANCELLATION_KEY, String(value));
        setEchoCancellationState(value);
    }, []);

    const setNoiseSuppression = useCallback((value) => {
        localStorage.setItem(NOISE_SUPPRESSION_KEY, String(value));
        setNoiseSuppressionState(value);
    }, []);

    const setAutoGainControl = useCallback((value) => {
        localStorage.setItem(AUTO_GAIN_CONTROL_KEY, String(value));
        setAutoGainControlState(value);
    }, []);

    const setRnnoise = useCallback((value) => {
        localStorage.setItem(RNNOISE_KEY, String(value));
        setRnnoiseState(value);
    }, []);

    return {
        inputDevice,
        outputDevice,
        vadSensitivity,
        echoCancellation,
        noiseSuppression,
        autoGainControl,
        rnnoiseEnabled,
        prefsRef,
        setInput,
        setOutput,
        setVadSensitivity,
        setEchoCancellation,
        setNoiseSuppression,
        setAutoGainControl,
        setRnnoise,
    };
}
