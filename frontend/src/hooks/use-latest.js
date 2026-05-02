import { useRef, useEffect } from 'preact/hooks';

/**
 * Returns a stable ref whose `.current` always holds the latest `value`.
 *
 * Replaces the repetitive `useEffect(() => { ref.current = value }, [value])`
 * pattern used for reading state inside callbacks / animation-frame loops
 * without stale closures.
 *
 * @template T
 * @param {T} value
 * @returns {{ readonly current: T }}
 */
export function useLatest(value) {
    const ref = useRef(value);
    useEffect(() => { ref.current = value; }, [value]);
    return ref;
}
