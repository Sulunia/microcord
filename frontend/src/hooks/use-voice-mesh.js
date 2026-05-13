import { useCallback, useRef } from 'preact/hooks';
import { createPeerMap } from './webrtc-helpers.js';
import { useLiveMediaConfig } from './use-live-media-config.js';
import { mungeOpusSdp } from './voice-sdp.js';
import { AUDIO_OUTPUT_KEY } from '../constants.js';

/**
 * Retry audio playback on first user gesture when the browser blocks autoplay.
 * @param {HTMLAudioElement} audio
 */
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
 * Manages the WebRTC mesh for voice: peer connections, SDP munging,
 * audio sender gating, remote audio elements, and peer lifecycle.
 *
 * @param {object} options
 * @param {(type: string, data: unknown) => void} options.send — realtime send fn
 * @param {import('preact/hooks').MutableRef<MediaStream | null>} options.streamRef — local mic stream ref
 * @param {import('preact/hooks').MutableRef<boolean>} options.vadSpeakingRef — whether VAD currently detects speech
 * @param {import('preact/hooks').MutableRef<boolean>} options.isMutedRef — latest mute state
 */
export function useVoiceMesh({ send, streamRef, vadSpeakingRef, isMutedRef }) {
    const peerMapRef = useRef(null);
    const audioSendersRef = useRef(new Map());
    const audioElementsRef = useRef(new Map());
    const { iceServers, audioConfig } = useLiveMediaConfig();

    /** Lazily create the peer map (reads ICE servers at call time). */
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

    /** Munge SDP with the current audio config. */
    const mungeSdp = useCallback((sdp) => {
        return mungeOpusSdp(sdp, audioConfig.opus_bitrate, audioConfig.opus_stereo);
    }, [audioConfig]);

    /**
     * Enable or disable the audio track on all peer senders.
     * Used for push-to-talk / VAD gating.
     *
     * @param {boolean} enabled
     */
    const gateAudioToPeers = useCallback((enabled) => {
        const audioTrack = streamRef.current?.getAudioTracks()[0];
        audioSendersRef.current.forEach((sender) => {
            sender.replaceTrack(enabled ? audioTrack : null).catch(() => {});
        });
    }, [streamRef]);

    /**
     * Callback invoked when a new RTCPeerConnection is created for a target.
     * Adds local tracks, stores audio sender, and wires up `ontrack` for
     * remote audio playback via hidden DOM audio elements.
     */
    const onPeerCreated = useCallback((peerConnection, targetId) => {
        const stream = streamRef.current;
        if (!stream) return;

        stream.getTracks().forEach((track) => {
            const sender = peerConnection.addTrack(track, stream);
            if (track.kind === 'audio') {
                audioSendersRef.current.set(targetId, sender);
                const isActivelySpeaking = vadSpeakingRef.current && !isMutedRef.current;
                if (!isActivelySpeaking) {
                    sender.replaceTrack(null).catch(() => {});
                }
            }
        });

        peerConnection.ontrack = (event) => {
            const remoteStream = event.streams[0] || new MediaStream([event.track]);
            const existing = audioElementsRef.current.get(targetId);
            if (existing) {
                existing.audio.srcObject = remoteStream;
                ensureAudioPlay(existing.audio);
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
    }, [streamRef, vadSpeakingRef, isMutedRef]);

    /**
     * Send offers to all given participants (excluding `excludeUserId`).
     *
     * @param {{ user_id?: string, id?: string }[]} participantList
     * @param {string} excludeUserId — current user's ID
     */
    const sendOffersToParticipants = useCallback(async (participantList, excludeUserId) => {
        const peerMap = getPeerMap();
        for (const participant of participantList) {
            const participantId = participant.user_id || participant.id;
            if (participantId === excludeUserId) continue;
            await peerMap.sendOffer(participantId, {
                onCreated: onPeerCreated,
                mungeSdp,
            });
        }
    }, [onPeerCreated, mungeSdp]);

    /**
     * Apply an incoming signal to the peer map.
     *
     * @param {string} fromId
     * @param {{ type: string, sdp?: string, candidate?: RTCIceCandidateInit }} signal
     */
    const applySignal = useCallback((fromId, signal) => {
        getPeerMap().applySignal(fromId, signal, {
            onCreated: onPeerCreated,
            mungeSdp,
        });
    }, [onPeerCreated, mungeSdp]);

    /** Close a single peer, remove its audio element and sender entry. */
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

    /** Close all peers, remove all audio elements, clear sender map. */
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

    /**
     * Set the playback volume for a specific remote peer.
     *
     * @param {string} targetUserId
     * @param {number} volume — 0…1
     */
    const setVolume = useCallback((targetUserId, volume) => {
        const entry = audioElementsRef.current.get(targetUserId);
        if (entry) {
            entry.volume = volume;
            entry.audio.volume = volume;
        }
    }, []);

    return {
        getPeerMap,
        mungeSdp,
        gateAudioToPeers,
        onPeerCreated,
        sendOffersToParticipants,
        applySignal,
        disposePeer,
        disposeAllPeers,
        setVolume,
    };
}
