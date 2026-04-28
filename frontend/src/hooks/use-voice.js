import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { API_BASE, LIVE_MEDIA_CONFIG, initLiveMediaConfig } from '../constants.js';
import { authHeaders } from './use-user.js';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const DEFAULT_AUDIO_CONFIG = {
    echo_cancellation: true,
    noise_suppression: true,
    auto_gain_control: true,
    opus_bitrate: 32000,
    opus_stereo: false,
};

export function computeVadThreshold(sensitivity) {
    const s = Math.max(1, Math.min(100, sensitivity));
    return Math.pow(10, -4 + (100 - s) / 100 * 3);
}

function ensureAudioPlay(audio) {
    const p = audio.play();
    if (!p) return;
    p.catch((err) => {
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
    const pt = match[1];
    const fmtpRe = new RegExp(`a=fmtp:${pt} [^\\r\\n]*`);
    const existing = sdp.match(fmtpRe);
    if (existing) {
        let line = existing[0];
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
        return sdp.replace(fmtpRe, line);
    }
    const rtpmapRe = new RegExp(`(a=rtpmap:${pt} opus/48000[^\\r\\n]*)`);
    return sdp.replace(
        rtpmapRe,
        `$1\r\na=fmtp:${pt} maxaveragebitrate=${bitrate};stereo=${stereo ? 1 : 0}`,
    );
}

export function useVoice(user, wsRef) {
    const [participants, setParticipants] = useState([]);
    const [isJoined, setIsJoined] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [speakingUsers, setSpeakingUsers] = useState(new Map());
    const [isSpeaking, setIsSpeaking] = useState(false);
    const streamRef = useRef(null);
    const peerConnectionsRef = useRef(new Map());
    const audioElementsRef = useRef(new Map());
    const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
    const audioConfigRef = useRef(DEFAULT_AUDIO_CONFIG);
    const userRef = useRef(user);
    const isJoinedRef = useRef(false);
    const vadAudioCtxRef = useRef(null);
    const vadAnalyserRef = useRef(null);
    const vadRafRef = useRef(null);
    const vadSpeakingRef = useRef(false);
    const vadLastChangeRef = useRef(0);
    const isMutedRef = useRef(false);

    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { isJoinedRef.current = isJoined; }, [isJoined]);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

    const userId = user?.id;

    useEffect(() => {
        initLiveMediaConfig().then(() => {
            iceServersRef.current = LIVE_MEDIA_CONFIG.iceServers;
            audioConfigRef.current = LIVE_MEDIA_CONFIG.audio;
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
        const DEBOUNCE_MS = 90;

        const tick = () => {
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                const v = (data[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            const sensitivity = parseInt(localStorage.getItem('mc-vad-sensitivity'), 10) || 50;
            const threshold = computeVadThreshold(sensitivity);
            const now = performance.now();

            if (rms > threshold !== vadSpeakingRef.current) {
                if (now - vadLastChangeRef.current >= DEBOUNCE_MS) {
                    vadSpeakingRef.current = !vadSpeakingRef.current;
                    vadLastChangeRef.current = now;
                    setIsSpeaking(vadSpeakingRef.current);
                    const s = streamRef.current;
                    if (s) {
                        const shouldEnable = vadSpeakingRef.current && !isMutedRef.current;
                        s.getAudioTracks().forEach((t) => { t.enabled = shouldEnable; });
                    }
                    const ws = wsRef?.current;
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'voice_speaking',
                            data: { speaking: vadSpeakingRef.current },
                        }));
                    }
                }
            } else {
                vadLastChangeRef.current = now;
            }

            vadRafRef.current = requestAnimationFrame(tick);
        };

        vadRafRef.current = requestAnimationFrame(tick);
    }, [wsRef, stopVad]);

    const fetchParticipants = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/voice/participants`, { headers: authHeaders() });
            if (res.ok) setParticipants(await res.json());
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { fetchParticipants(); }, [fetchParticipants]);

    const sendSignal = useCallback((targetId, signal) => {
        const ws = wsRef?.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'voice_signal',
                data: { target: targetId, signal },
            }));
        }
    }, [wsRef]);

    const mungeSdp = useCallback((sdp) => {
        const cfg = audioConfigRef.current;
        return mungeOpusSdp(sdp, cfg.opus_bitrate, cfg.opus_stereo);
    }, []);

    const createPC = useCallback((targetId) => {
        const existing = peerConnectionsRef.current.get(targetId);
        if (existing) existing.close();

        const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

        const stream = streamRef.current;
        if (stream) {
            stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        }

        pc.onicecandidate = (e) => {
            if (!e.candidate) return;
            sendSignal(targetId, { type: 'ice-candidate', candidate: e.candidate });
        };

        pc.ontrack = (event) => {
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

        peerConnectionsRef.current.set(targetId, pc);
        return pc;
    }, [sendSignal]);

    const sendOffer = useCallback(async (targetId) => {
        const pc = createPC(targetId);
        const offer = await pc.createOffer();
        const munged = mungeSdp(offer.sdp);
        await pc.setLocalDescription({ type: offer.type, sdp: munged });
        sendSignal(targetId, { type: 'offer', sdp: munged });
    }, [createPC, sendSignal, mungeSdp]);

    const handleSignal = useCallback(async (fromId, signal) => {
        switch (signal.type) {
            case 'offer': {
                const pc = createPC(fromId);
                await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
                const answer = await pc.createAnswer();
                const munged = mungeSdp(answer.sdp);
                await pc.setLocalDescription({ type: answer.type, sdp: munged });
                sendSignal(fromId, { type: 'answer', sdp: munged });
                break;
            }
            case 'answer': {
                const pc = peerConnectionsRef.current.get(fromId);
                if (pc) await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
                break;
            }
            case 'ice-candidate': {
                const pc = peerConnectionsRef.current.get(fromId);
                if (pc && signal.candidate) {
                    await pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
                }
                break;
            }
        }
    }, [createPC, sendSignal, mungeSdp]);

    useEffect(() => {
        if (!wsRef?.current) return;
        const ws = wsRef.current;

        const onMessage = (e) => {
            if (typeof e.data !== 'string') return;
            let msg;
            try { msg = JSON.parse(e.data); } catch { return; }

            switch (msg.type) {
                case 'voice_participant_joined':
                    if (isJoinedRef.current) {
                        const enterAudio = new Audio('/sounds/EnterVoice.wav');
                        enterAudio.volume = 0.7;
                        enterAudio.play().catch(() => {});
                    }
                    fetchParticipants();
                    break;
                case 'voice_participant_left': {
                    if (isJoinedRef.current) {
                        const exitAudio = new Audio('/sounds/ExitVoice.wav');
                        exitAudio.volume = 0.55;
                        exitAudio.play().catch(() => {});
                    }
                    const pid = msg.data.user_id;
                    const pc = peerConnectionsRef.current.get(pid);
                    if (pc) { pc.close(); peerConnectionsRef.current.delete(pid); }
                    const entry = audioElementsRef.current.get(pid);
                    if (entry) {
                        entry.audio.pause();
                        entry.audio.srcObject = null;
                        if (entry.audio.parentNode) entry.audio.parentNode.removeChild(entry.audio);
                        audioElementsRef.current.delete(pid);
                    }
                    fetchParticipants();
                    break;
                }
                case 'voice_signal': {
                    const { from, signal } = msg.data;
                    if (isJoinedRef.current) handleSignal(from, signal);
                    break;
                }
                case 'voice_mute': {
                    const { user_id: muteUid, muted } = msg.data;
                    setParticipants((prev) =>
                        prev.map((p) => {
                            const pid = p.user_id || p.id;
                            return pid === muteUid ? { ...p, muted } : p;
                        }),
                    );
                    break;
                }
                case 'voice_speaking': {
                    const { user_id: speakUid, speaking } = msg.data;
                    setSpeakingUsers((prev) => {
                        const next = new Map(prev);
                        next.set(speakUid, speaking);
                        return next;
                    });
                    break;
                }
                case 'screenshare_start':
                case 'screenshare_stop':
                case 'user_updated':
                    fetchParticipants();
                    break;
            }
        };

        ws.addEventListener('message', onMessage);
        return () => ws.removeEventListener('message', onMessage);
    }, [wsRef?.current, fetchParticipants, handleSignal]);

    const cleanupPeerConnections = useCallback(() => {
        peerConnectionsRef.current.forEach((pc) => pc.close());
        peerConnectionsRef.current.clear();
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
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setIsMuted(false);
        setIsSpeaking(false);
        setSpeakingUsers(new Map());
    }, [cleanupPeerConnections, stopVad]);

    useEffect(() => cleanup, [cleanup]);

    useEffect(() => {
        if (!userId || !isJoined) return;
        const onBeforeUnload = () => { cleanup(); };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [userId, isJoined, cleanup]);

    const join = useCallback(async () => {
        const u = userRef.current;
        if (!u || isJoined) return;

        try {
            const cfg = audioConfigRef.current;
            const inputDeviceId = localStorage.getItem('mc-audio-input');
            const audioConstraints = {
                echoCancellation: cfg.echo_cancellation,
                noiseSuppression: cfg.noise_suppression,
                autoGainControl: cfg.auto_gain_control,
                ...(inputDeviceId ? { deviceId: { exact: inputDeviceId } } : {}),
            };
            const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
            streamRef.current = stream;
            stream.getAudioTracks().forEach((t) => { t.enabled = false; });

            const res = await fetch(`${API_BASE}/voice/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error('Join failed');

            const { participants: pList } = await res.json();
            setParticipants(pList);
            setIsJoined(true);

            startVad();

            for (const p of pList) {
                const pid = p.user_id || p.id;
                if (pid === u.id) continue;
                await sendOffer(pid);
            }
        } catch (err) {
            console.error('Voice join error:', err);
            cleanup();
        }
    }, [isJoined, cleanup, sendOffer, startVad]);

    const leave = useCallback(async () => {
        const u = userRef.current;
        if (!u) return;

        cleanup();

        await fetch(`${API_BASE}/voice/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({}),
        }).catch(() => {});

        setIsJoined(false);
        await fetchParticipants();
    }, [fetchParticipants, cleanup]);

    const toggleMute = useCallback(() => {
        setIsMuted((prev) => {
            const next = !prev;
            const stream = streamRef.current;
            if (stream) {
                const shouldEnable = !next && vadSpeakingRef.current;
                stream.getAudioTracks().forEach((t) => { t.enabled = shouldEnable; });
            }
            const ws = wsRef?.current;
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'voice_mute',
                    data: { muted: next },
                }));
            }
            return next;
        });
    }, [wsRef]);

    const setVolume = useCallback((uid, volume) => {
        const entry = audioElementsRef.current.get(uid);
        if (entry) {
            entry.volume = volume;
            entry.audio.volume = volume;
        }
    }, []);

    return { participants, isJoined, isMuted, isSpeaking, speakingUsers, join, leave, toggleMute, setVolume, fetchParticipants };
}
