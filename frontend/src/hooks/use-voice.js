import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { API_BASE, LIVE_MEDIA_CONFIG, initLiveMediaConfig } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { createPeerMap } from './webrtc-helpers.js';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const DEFAULT_AUDIO_CONFIG = {
    echo_cancellation: true,
    noise_suppression: true,
    auto_gain_control: true,
    opus_bitrate: 32000,
    opus_stereo: false,
};

/**
 * Convert a 1–100 sensitivity slider value to an RMS threshold.
 * Higher sensitivity → lower threshold → easier to trigger speaking.
 *
 * @param {number} sensitivity — slider value (1–100, default 50)
 * @returns {number} RMS threshold in the range 10⁻⁴ … 10⁻¹
 */
export function computeVadThreshold(sensitivity) {
    const clamped = Math.max(1, Math.min(100, sensitivity));
    return Math.pow(10, -4 + (100 - clamped) / 100 * 3);
}

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

/**
 * Munge an SDP description to apply Opus codec parameters.
 *
 * @param {string} sdp
 * @param {number} bitrate — maxaveragebitrate (6000–510000)
 * @param {boolean} stereo
 * @returns {string} Munged SDP
 */
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
 * Voice-channel hook.
 *
 * Join/leave lifecycle is modelled as a small state machine:
 *   `idle` → `joining` → `joined` → `leaving` → `idle`
 *                      ↘ `error` → `idle`
 *
 * If the backend join succeeds but later local setup (VAD, WebRTC offers)
 * fails, the hook rolls back by calling `POST /voice/leave`.
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
    const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
    const audioConfigRef = useRef(DEFAULT_AUDIO_CONFIG);
    const userRef = useRef(user);
    const joinStateRef = useRef('idle');
    const vadAudioCtxRef = useRef(null);
    const vadAnalyserRef = useRef(null);
    const vadRafRef = useRef(null);
    const vadSpeakingRef = useRef(false);
    const vadLastChangeRef = useRef(0);
    const isMutedRef = useRef(false);

    const isJoined = joinState === 'joined';

    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { joinStateRef.current = joinState; }, [joinState]);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

    const { send, subscribe } = useRealtime();

    useEffect(() => {
        initLiveMediaConfig().then(() => {
            iceServersRef.current = LIVE_MEDIA_CONFIG.iceServers;
            audioConfigRef.current = LIVE_MEDIA_CONFIG.audio;
        });
    }, []);

    function getPeerMap() {
        if (!peerMapRef.current) {
            peerMapRef.current = createPeerMap(() => ({
                iceServers: iceServersRef.current,
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
        if (vadRafRef.current) {
            cancelAnimationFrame(vadRafRef.current);
            vadRafRef.current = null;
        }
        if (vadAudioCtxRef.current) {
            vadAudioCtxRef.current.close().catch(() => {});
            vadAudioCtxRef.current = null;
        }
        vadAnalyserRef.current = null;
        vadSpeakingRef.current = false;
    }, []);

    const startVad = useCallback(() => {
        stopVad();
        const stream = streamRef.current;
        if (!stream) return;

        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);
        if (audioCtx.state === 'suspended') audioCtx.resume();

        vadAudioCtxRef.current = audioCtx;
        vadAnalyserRef.current = analyser;

        const data = new Uint8Array(analyser.fftSize);
        const RISING_DEBOUNCE_MS = 22;
        const FALLING_DEBOUNCE_MS = 180;

        const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const sample = (data[i] - 128) / 128;
                sum += sample * sample;
            }
            const rms = Math.sqrt(sum / data.length);
            const sensitivity = parseInt(localStorage.getItem('mc-vad-sensitivity'), 10) || 50;
            const threshold = computeVadThreshold(sensitivity);
            const now = performance.now();
            const wouldStartSpeaking = rms > threshold && !vadSpeakingRef.current;

            if (rms > threshold !== vadSpeakingRef.current) {
                const debounceMs = wouldStartSpeaking ? RISING_DEBOUNCE_MS : FALLING_DEBOUNCE_MS;
                if (now - vadLastChangeRef.current >= debounceMs) {
                    vadSpeakingRef.current = !vadSpeakingRef.current;
                    vadLastChangeRef.current = now;
                    setIsSpeaking(vadSpeakingRef.current);
                    gateAudioToPeers(vadSpeakingRef.current && !isMutedRef.current);
                    send('voice_speaking', { speaking: vadSpeakingRef.current });
                }
            } else {
                vadLastChangeRef.current = now;
            }

            vadRafRef.current = requestAnimationFrame(tick);
        };

        vadRafRef.current = requestAnimationFrame(tick);
    }, [send, stopVad, gateAudioToPeers]);

    const fetchParticipants = useCallback(async () => {
        try {
            const response = await authedFetch(`${API_BASE}/voice/participants`);
            if (response.ok) setParticipants(await response.json());
        } catch {}
    }, []);

    useEffect(() => { fetchParticipants(); }, [fetchParticipants]);

    const mungeSdp = useCallback((sdp) => {
        const config = audioConfigRef.current;
        return mungeOpusSdp(sdp, config.opus_bitrate, config.opus_stereo);
    }, []);

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

                const outputDeviceId = localStorage.getItem('mc-audio-output');
                if (outputDeviceId && typeof audio.setSinkId === 'function') {
                    audio.setSinkId(outputDeviceId).catch(() => {});
                }
                audio.srcObject = remoteStream;
                ensureAudioPlay(audio);
                audioElementsRef.current.set(targetId, { audio, volume: 1.0 });
            }
        };
    }, []);

    const cleanupPeerConnections = useCallback(() => {
        peerMapRef.current?.closeAllPeers();
        audioSendersRef.current.clear();
        audioElementsRef.current.forEach(({ audio }) => {
            audio.pause();
            audio.srcObject = null;
            if (audio.parentNode) audio.parentNode.removeChild(audio);
        });
        audioElementsRef.current.clear();
    }, []);

    const cleanup = useCallback(() => {
        stopVad();
        cleanupPeerConnections();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setIsMuted(false);
        setIsSpeaking(false);
        setSpeakingUsers(new Map());
    }, [cleanupPeerConnections, stopVad]);

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
                    const enterAudio = new Audio('/sounds/EnterVoice.wav');
                    enterAudio.volume = 0.7;
                    enterAudio.play().catch(() => {});
                }
                fetchParticipants();
            }),
            subscribe('voice_participant_left', (data) => {
                if (joinStateRef.current === 'joined') {
                    const exitAudio = new Audio('/sounds/ExitVoice.wav');
                    exitAudio.volume = 0.55;
                    exitAudio.play().catch(() => {});
                }
                const leftUserId = data.user_id;
                getPeerMap().closePeer(leftUserId);
                audioSendersRef.current.delete(leftUserId);
                const entry = audioElementsRef.current.get(leftUserId);
                if (entry) {
                    entry.audio.pause();
                    entry.audio.srcObject = null;
                    if (entry.audio.parentNode) entry.audio.parentNode.removeChild(entry.audio);
                    audioElementsRef.current.delete(leftUserId);
                }
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
    }, [subscribe, fetchParticipants, voiceOnCreated, mungeSdp]);

    const join = useCallback(async () => {
        const currentUser = userRef.current;
        if (!currentUser || joinStateRef.current !== 'idle') return;

        setJoinState('joining');
        let backendJoined = false;

        try {
            const config = audioConfigRef.current;
            const inputDeviceId = localStorage.getItem('mc-audio-input');
            const audioConstraints = {
                echoCancellation: config.echo_cancellation,
                noiseSuppression: config.noise_suppression,
                autoGainControl: config.auto_gain_control,
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
    }, [cleanup, startVad, voiceOnCreated, mungeSdp]);

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
    }, [fetchParticipants, cleanup]);

    const toggleMute = useCallback(() => {
        setIsMuted((prev) => {
            const next = !prev;
            gateAudioToPeers(!next && vadSpeakingRef.current);
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
