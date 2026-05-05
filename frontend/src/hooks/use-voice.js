import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { API_BASE } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { useAudioPreferences } from './use-audio-preferences.js';
import { startVadMonitor } from './vad-monitor.js';
import { useLatest } from './use-latest.js';
import { useLiveMediaConfig } from './use-live-media-config.js';
import { useVoiceMesh } from './use-voice-mesh.js';
import { useVoiceParticipants } from './use-voice-participants.js';

/**
 * Voice-channel hook — thin orchestrator composing focused modules.
 *
 * Lifecycle state machine:
 *   `idle` → `joining` → `joined` → `leaving` → `idle`
 *                      ↘ `error` → `idle`
 *
 * Delegates to:
 *   - `useVoiceMesh` — WebRTC peer connections, audio senders, remote audio elements
 *   - `useVoiceParticipants` — participant list, speaking state, WS subscriptions
 *   - `startVadMonitor` (vad-monitor.js) — RMS-based VAD
 *   - `useLiveMediaConfig` — ICE servers / audio config
 *   - `useAudioPreferences` — input device / VAD sensitivity
 *
 * @param {{ id: string } | null} user
 */
export function useVoice(user) {
    const [joinState, setJoinState] = useState('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    const streamRef = useRef(null);
    const vadMonitorRef = useRef(null);
    const vadSpeakingRef = useRef(false);

    const isJoined = joinState === 'joined';

    const { prefsRef } = useAudioPreferences();
    const { audioConfig } = useLiveMediaConfig();
    const { send, connectionId } = useRealtime();

    const userRef = useLatest(user);
    const joinStateRef = useLatest(joinState);
    const isMutedRef = useLatest(isMuted);

    const {
        gateAudioToPeers,
        sendOffersToParticipants,
        applySignal,
        disposePeer,
        disposeAllPeers,
        setVolume,
    } = useVoiceMesh({ send, streamRef, vadSpeakingRef, isMutedRef });

    const {
        participants,
        setParticipants,
        speakingUsers,
        resetSpeakingUsers,
        fetchParticipants,
        joinedElsewhere,
        setJoinedElsewhere,
    } = useVoiceParticipants({
        joinStateRef,
        userId: user?.id ?? null,
        connectionId,
        onParticipantLeft: disposePeer,
        onSignal: applySignal,
    });

    const joinedElsewhereRef = useLatest(joinedElsewhere);

    // ── VAD lifecycle ───────────────────────────────────────────────

    const stopVad = useCallback(() => {
        if (vadMonitorRef.current) {
            vadMonitorRef.current.stop();
            vadMonitorRef.current = null;
        }
        vadSpeakingRef.current = false;
    }, []);

    const startVad = useCallback(() => {
        stopVad();
        const stream = streamRef.current;
        if (!stream) return;

        vadMonitorRef.current = startVadMonitor(stream, {
            prefsRef,
            onSpeakingChange(speaking) {
                vadSpeakingRef.current = speaking;
                if (isMutedRef.current) {
                    gateAudioToPeers(false);
                    if (speaking) {
                        send('voice_speaking', { speaking: false });
                    }
                } else {
                    setIsSpeaking(speaking);
                    gateAudioToPeers(speaking);
                    send('voice_speaking', { speaking });
                }
            },
        });
    }, [send, stopVad, gateAudioToPeers, prefsRef, isMutedRef]);

    // ── Local voice cleanup ─────────────────────────────────────────

    const disposeLocalVoice = useCallback(() => {
        stopVad();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, [stopVad]);

    const resetVoiceState = useCallback(() => {
        setIsMuted(false);
        setIsSpeaking(false);
        resetSpeakingUsers();
        setJoinedElsewhere(false);
    }, [resetSpeakingUsers, setJoinedElsewhere]);

    const cleanup = useCallback(() => {
        disposeLocalVoice();
        disposeAllPeers();
        resetVoiceState();
    }, [disposeLocalVoice, disposeAllPeers, resetVoiceState]);

    // ── Effects ──────────────────────────────────────────────────────

    useEffect(() => cleanup, [cleanup]);

    useEffect(() => {
        if (!user?.id || !isJoined) return;
        const onBeforeUnload = () => { cleanup(); };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [user?.id, isJoined, cleanup]);

    // ── Actions ──────────────────────────────────────────────────────

    const join = useCallback(async () => {
        const currentUser = userRef.current;
        if (!currentUser || joinStateRef.current !== 'idle') return;
        if (joinedElsewhereRef.current) return;

        setJoinState('joining');
        let backendJoined = false;

        try {
            const inputDeviceId = prefsRef.current.inputDevice;
            const audioConstraints = {
                echoCancellation: audioConfig.echo_cancellation,
                noiseSuppression: audioConfig.noise_suppression,
                autoGainControl: audioConfig.auto_gain_control,
                ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
            };

            let noInputDevice = false;
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
                streamRef.current = stream;
            } catch (micErr) {
                console.warn('No input device available, joining muted:', micErr.message || micErr);
                noInputDevice = true;
            }

            const response = await authedFetch(`${API_BASE}/voice/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ connection_id: connectionId }),
            });
            if (!response.ok) throw new Error('Join failed');
            backendJoined = true;

            const { participants: participantList } = await response.json();
            setParticipants(participantList);
            setJoinState('joined');

            if (noInputDevice) {
                setIsMuted(true);
                send('voice_mute', { muted: true });
            } else {
                startVad();
            }

            await sendOffersToParticipants(participantList, currentUser.id);
        } catch (err) {
            console.error('Voice join error:', err);
            cleanup();
            if (backendJoined) {
                await authedFetch(`${API_BASE}/voice/leave`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                }).catch(() => {});
            }
            setJoinState('idle');
        }
    }, [cleanup, startVad, sendOffersToParticipants, prefsRef, audioConfig, userRef, joinStateRef, setParticipants, connectionId, joinedElsewhereRef]);

    const leave = useCallback(async () => {
        const currentUser = userRef.current;
        if (!currentUser) return;

        setJoinState('leaving');
        cleanup();

        await authedFetch(`${API_BASE}/voice/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        }).catch(() => {});

        setJoinState('idle');
        await fetchParticipants();
    }, [fetchParticipants, cleanup, userRef]);

    const toggleMute = useCallback(() => {
        setIsMuted((prev) => {
            const next = !prev;
            if (next && vadSpeakingRef.current) {
                gateAudioToPeers(false);
                send('voice_speaking', { speaking: false });
                setIsSpeaking(false);
            } else if (!next && vadSpeakingRef.current) {
                gateAudioToPeers(true);
                send('voice_speaking', { speaking: true });
            }
            send('voice_mute', { muted: next });
            return next;
        });
    }, [send, gateAudioToPeers]);

    return {
        participants,
        isJoined,
        joinState,
        isMuted,
        isSpeaking,
        speakingUsers,
        join,
        leave,
        toggleMute,
        setVolume,
        fetchParticipants,
        joinedElsewhere,
    };
}
