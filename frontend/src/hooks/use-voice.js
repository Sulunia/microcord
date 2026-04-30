import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { API_BASE, AUDIO_OUTPUT_KEY } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { createPeerMap } from './webrtc-helpers.js';
import { useAudioPreferences } from './use-audio-preferences.js';
import { startVadMonitor } from './vad-monitor.js';
import { useLatest } from './use-latest.js';
import { useLiveMediaConfig } from './use-live-media-config.js';
import { playNotification, SOUND_ENTER_VOICE, SOUND_EXIT_VOICE } from './audio-notifications.js';

function ensureAudioPlay(audio) {
    const playPromise = audio.play();
    if (!playPromise) return;
    playPromise.catch((err) => {
        if (err.name === 'NotAllowedError') {
            const retry = () => {
                audio.play().catch(() => {});
                document.removeEventListener('click', retry);
                document.removeEventListener('keydown', retry);
            };
            document.addEventListener('click', retry);
            document.addEventListener('keydown', retry);
        }
    });
}

function mungeOpusSdp(sdp, bitrate, stereo) {
    const match = sdp.match(/a=rtpmap:(\d+) opus\/48000/);
    if (!match) return sdp;
    const payloadType = match[1];
    const fmtpPattern = new RegExp(`a=fmtp:${payloadType} [^\\r\\n]*`);
    const existingFmtp = sdp.match(fmtpPattern);

    if (existingFmtp) {
        let line = existingFmtp[0];
        if (/maxaveragebitrate=/.test(line)) {
            line = line.replace(/maxaveragebitrate=\d+/, `maxaveragebitrate=${bitrate}`);
        } else {
            line += `;maxaveragebitrate=${bitrate}`;
        }
        if (/stereo=/.test(line)) {
            line = line.replace(/stereo=\d/, `stereo=${stereo ? 1 : 0}`);
        } else {
            line += `;stereo=${stereo ? 1 : 0}`;
        }
        return sdp.replace(fmtpPattern, line);
    }

    const rtpmapPattern = new RegExp(`(a=rtpmap:${payloadType} opus/48000[^\\r\\n]*)`);
    return sdp.replace(
        rtpmapPattern,
        `$1\r\na=fmtp:${payloadType} maxaveragebitrate=${bitrate};stereo=${stereo ? 1 : 0}`,
    );
}

/**
 * Voice-channel hook with centralised cleanup ownership.
 *
 * Lifecycle is a small state machine:
 *   `idle` → `joining` → `joined` → `leaving` → `idle`
 *                      ↘ `error` → `idle`
 *
 * Cleanup is consolidated into four ownership functions:
 *   - `disposePeer(userId)`  — single peer + its audio element + sender
 *   - `disposeAllPeers()`    — all peers + audio elements + senders
 *   - `disposeLocalVoice()`  — mic stream + VAD monitor
 *   - `resetVoiceState()`    — resets React state to idle defaults
 *
 * @param {{ id: string } | null} user
 */
export function useVoice(user) {
    const [participants, setParticipants] = useState([]);
    const [joinState, setJoinState] = useState('idle');
    const [isMuted, setIsMuted] = useState(false);
    const [speakingUsers, setSpeakingUsers] = useState(new Map());
    const [isSpeaking, setIsSpeaking] = useState(false);

    const streamRef = useRef(null);
    const peerMapRef = useRef(null);
    const audioSendersRef = useRef(new Map());
    const audioElementsRef = useRef(new Map());
    const vadMonitorRef = useRef(null);
    const vadSpeakingRef = useRef(false);

    const isJoined = joinState === 'joined';

    const { prefsRef } = useAudioPreferences();
    const { iceServers, audioConfig } = useLiveMediaConfig();

    const userRef = useLatest(user);
    const joinStateRef = useLatest(joinState);
    const isMutedRef = useLatest(isMuted);

    const { send, subscribe } = useRealtime();

    function getPeerMap() {
        if (!peerMapRef.current) {
            peerMapRef.current = createPeerMap(() => ({
                iceServers,
                sendSignal: (targetId, signal) =>
                    send('voice_signal', { target: targetId, signal }),
            }));
        }
        return peerMapRef.current;
    }

    const gateAudioToPeers = useCallback((enabled) => {
        const audioTrack = streamRef.current?.getAudioTracks()[0];
        audioSendersRef.current.forEach((sender) => {
            sender.replaceTrack(enabled ? audioTrack : null).catch(() => {});
        });
    }, []);

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

    const fetchParticipants = useCallback(async () => {
        try {
            const response = await authedFetch(`${API_BASE}/voice/participants`);
            if (response.ok) setParticipants(await response.json());
        } catch {}
    }, []);

    useEffect(() => { fetchParticipants(); }, [fetchParticipants]);

    const mungeSdp = useCallback((sdp) => {
        return mungeOpusSdp(sdp, audioConfig.opus_bitrate, audioConfig.opus_stereo);
    }, [audioConfig]);

    const voiceOnCreated = useCallback((peerConnection, targetId) => {
        const stream = streamRef.current;
        if (!stream) return;
        stream.getTracks().forEach((track) => {
            const sender = peerConnection.addTrack(track, stream);
            if (track.kind === 'audio') {
                audioSendersRef.current.set(targetId, sender);
                if (!(vadSpeakingRef.current && !isMutedRef.current)) {
                    sender.replaceTrack(null).catch(() => {});
                }
            }
        });

        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            let entry = audioElementsRef.current.get(targetId);
            if (entry) {
                entry.audio.srcObject = remoteStream;
                ensureAudioPlay(entry.audio);
            } else {
                const audio = document.createElement('audio');
                audio.setAttribute('autoplay', '');
                audio.setAttribute('playsinline', '');
                audio.style.display = 'none';
                document.body.appendChild(audio);

                const outputDeviceId = localStorage.getItem(AUDIO_OUTPUT_KEY);
                if (outputDeviceId && typeof audio.setSinkId === 'function') {
                    audio.setSinkId(outputDeviceId).catch(() => {});
                }
                audio.srcObject = remoteStream;
                ensureAudioPlay(audio);
                audioElementsRef.current.set(targetId, { audio, volume: 1.0 });
            }
        };
    }, [isMutedRef]);

    // ── Centralised cleanup ownership ────────────────────────────────

    const disposePeer = useCallback((userId) => {
        getPeerMap().closePeer(userId);
        audioSendersRef.current.delete(userId);
        const entry = audioElementsRef.current.get(userId);
        if (entry) {
            entry.audio.pause();
            entry.audio.srcObject = null;
            if (entry.audio.parentNode) entry.audio.parentNode.removeChild(entry.audio);
            audioElementsRef.current.delete(userId);
        }
    }, []);

    const disposeAllPeers = useCallback(() => {
        peerMapRef.current?.closeAllPeers();
        audioSendersRef.current.clear();
        audioElementsRef.current.forEach(({ audio }) => {
            audio.pause();
            audio.srcObject = null;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        });
        audioElementsRef.current.clear();
    }, []);

    const disposeLocalVoice = useCallback(() => {
        stopVad();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }, [stopVad]);

    const resetVoiceState = useCallback(() => {
        setIsMuted(false);
        setIsSpeaking(false);
        setSpeakingUsers(new Map());
    }, []);

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

    useEffect(() => {
        const unsubs = [
            subscribe('voice_participant_joined', () => {
                if (joinStateRef.current === 'joined') {
                    playNotification(SOUND_ENTER_VOICE, 0.7);
                }
                fetchParticipants();
            }),
            subscribe('voice_participant_left', (data) => {
                if (joinStateRef.current === 'joined') {
                    playNotification(SOUND_EXIT_VOICE, 0.55);
                }
                disposePeer(data.user_id);
                fetchParticipants();
            }),
            subscribe('voice_signal', (data) => {
                if (joinStateRef.current === 'joined') {
                    getPeerMap().applySignal(data.from, data.signal, {
                        onCreated: voiceOnCreated,
                        mungeSdp,
                    });
                }
            }),
            subscribe('voice_mute', (data) => {
                const { user_id: muteUserId, muted } = data;
                setParticipants((prev) =>
                    prev.map((participant) => {
                        const participantId = participant.user_id || participant.id;
                        return participantId === muteUserId ? { ...participant, muted } : participant;
                    }),
                );
            }),
            subscribe('voice_speaking', (data) => {
                const { user_id: speakUserId, speaking } = data;
                setSpeakingUsers((prev) => {
                    const next = new Map(prev);
                    next.set(speakUserId, speaking);
                    return next;
                });
            }),
            subscribe('screenshare_start', () => fetchParticipants()),
            subscribe('screenshare_stop', () => fetchParticipants()),
            subscribe('user_updated', () => fetchParticipants()),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, [subscribe, fetchParticipants, voiceOnCreated, mungeSdp, disposePeer, joinStateRef]);

    // ── Actions ──────────────────────────────────────────────────────

    const join = useCallback(async () => {
        const currentUser = userRef.current;
        if (!currentUser || joinStateRef.current !== 'idle') return;

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
            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            streamRef.current = stream;

            const response = await authedFetch(`${API_BASE}/voice/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!response.ok) throw new Error('Join failed');
            backendJoined = true;

            const { participants: participantList } = await response.json();
            setParticipants(participantList);
            setJoinState('joined');

            startVad();

            const peerMap = getPeerMap();
            for (const participant of participantList) {
                const participantId = participant.user_id || participant.id;
                if (participantId === currentUser.id) continue;
                await peerMap.sendOffer(participantId, {
                    onCreated: voiceOnCreated,
                    mungeSdp,
                });
            }
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
    }, [cleanup, startVad, voiceOnCreated, mungeSdp, prefsRef, audioConfig, userRef, joinStateRef]);

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

    const setVolume = useCallback((targetUserId, volume) => {
        const entry = audioElementsRef.current.get(targetUserId);
        if (entry) {
            entry.volume = volume;
            entry.audio.volume = volume;
        }
    }, []);

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
    };
}
