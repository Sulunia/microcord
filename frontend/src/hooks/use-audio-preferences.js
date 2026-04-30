import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { AUDIO_INPUT_KEY, AUDIO_OUTPUT_KEY, VAD_SENSITIVITY_KEY } from '../constants.js';

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

    const prefsRef = useRef({ inputDevice, outputDevice, vadSensitivity });
    useEffect(() => {
        prefsRef.current = { inputDevice, outputDevice, vadSensitivity };
    }, [inputDevice, outputDevice, vadSensitivity]);

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
    }, []);

    return {
        inputDevice,
        outputDevice,
        vadSensitivity,
        prefsRef,
        setInput,
        setOutput,
        setVadSensitivity,
    };
}
