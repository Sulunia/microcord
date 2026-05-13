import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { useRealtime } from './realtime.jsx';
import { createPeerMap } from './webrtc-helpers.js';
import { useLatest } from './use-latest.js';
import { useLiveMediaConfig } from './use-live-media-config.js';

function getDisplayConstraints(screenshareConfig) {
    return {
        video: {
            width: { ideal: screenshareConfig.width },
            height: { ideal: screenshareConfig.height },
            frameRate: { ideal: screenshareConfig.frameRate },
        },
        audio: true,
    };
}

export function useScreenshare(user, voiceParticipants, isVoiceJoined) {
    const [isSharing, setIsSharing] = useState(false);
    const [sharerUserId, setSharerUserId] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [dismissed, setDismissed] = useState(false);

    const localStreamRef = useRef(null);
    const peerMapRef = useRef(null);
    const suppressSharerSyncRef = useRef(false);

    const { send, subscribe, connected } = useRealtime();
    const { iceServers, screenshareConfig } = useLiveMediaConfig();

    const userRef = useLatest(user);

    function getPeerMap() {
        if (!peerMapRef.current) {
            peerMapRef.current = createPeerMap(() => ({
                iceServers,
                sendSignal: (targetId, signal) =>
                    send('screenshare_signal', { target: targetId, signal }),
            }));
        }
        return peerMapRef.current;
    }

    const isViewing = Boolean(sharerUserId) && Boolean(remoteStream) && !isSharing;
    const showPanel = isVoiceJoined && Boolean(sharerUserId) && (isSharing || !dismissed);
    const sharerName = voiceParticipants.find((participant) => participant.user_id === sharerUserId)?.name;

    useEffect(() => {
        if (isSharing) return;
        if (suppressSharerSyncRef.current) {
            suppressSharerSyncRef.current = false;
            return;
        }
        const sharer = voiceParticipants.find((participant) => participant.sharing);
        if (sharer) {
            setSharerUserId((prev) => prev === sharer.user_id ? prev : sharer.user_id);
        } else {
            setSharerUserId(null);
        }
    }, [voiceParticipants, isSharing]);

    const cleanupPeerConnections = useCallback(() => {
        peerMapRef.current?.closeAllPeers();
    }, []);

    const cleanupLocalStream = useCallback(() => {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
    }, []);

    const sharerOnCreated = useCallback((peerConnection) => {
        const stream = localStreamRef.current;
        if (stream) stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));
    }, []);

    const stopSharing = useCallback(() => {
        cleanupLocalStream();
        cleanupPeerConnections();
        suppressSharerSyncRef.current = true;
        send('screenshare_stop');
        setIsSharing(false);
        setSharerUserId(null);
        setRemoteStream(null);
    }, [send, cleanupLocalStream, cleanupPeerConnections]);

    const startSharing = useCallback(async () => {
        const currentUser = userRef.current;
        const isNotReadyToShare = !currentUser || !isVoiceJoined || isSharing;
        if (isNotReadyToShare) return;
        if (sharerUserId) return;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia(getDisplayConstraints(screenshareConfig));
            localStreamRef.current = stream;

            stream.getVideoTracks()[0]?.addEventListener('ended', () => {
                stopSharing();
            });

            if (!connected) throw new Error('WS not connected');
            send('screenshare_start');

            setIsSharing(true);
            setSharerUserId(currentUser.id);
            setRemoteStream(stream);

            const peerMap = getPeerMap();
            for (const participant of voiceParticipants) {
                const participantId = participant.user_id || participant.id;
                if (participantId === currentUser.id) continue;
                await peerMap.sendOffer(participantId, { onCreated: sharerOnCreated });
            }
        } catch (err) {
            if (err.name !== 'NotAllowedError') {
                console.error('Screenshare start error:', err);
            }
            cleanupLocalStream();
            cleanupPeerConnections();
        }
    }, [isVoiceJoined, isSharing, sharerUserId, connected, send, voiceParticipants, stopSharing, cleanupLocalStream, cleanupPeerConnections, sharerOnCreated, screenshareConfig, userRef]);

    const stopViewing = useCallback(() => {
        cleanupPeerConnections();
        setRemoteStream(null);
        setDismissed(true);
    }, [cleanupPeerConnections]);

    const requestStream = useCallback(() => {
        if (!sharerUserId || isSharing) return;
        setDismissed(false);
        send('screenshare_request');
    }, [sharerUserId, isSharing, send]);

    useEffect(() => {
        const unsubs = [
            subscribe('screenshare_start', (data) => {
                setSharerUserId(data.user_id);
                setDismissed(false);
            }),
            subscribe('screenshare_stop', () => {
                suppressSharerSyncRef.current = true;
                cleanupPeerConnections();
                setSharerUserId(null);
                setRemoteStream(null);
            }),
            subscribe('screenshare_error', (data) => {
                console.error('Screenshare error:', data.error);
                cleanupLocalStream();
                cleanupPeerConnections();
                setIsSharing(false);
            }),
            subscribe('screenshare_signal', (data) => {
                getPeerMap().applySignal(data.from, data.signal, {
                    onCreated: (peerConnection) => {
                        peerConnection.ontrack = (event) => {
                            setRemoteStream(event.streams[0] || new MediaStream([event.track]));
                        };
                    },
                });
            }),
            subscribe('screenshare_request', (data) => {
                const requesterId = data.user_id;
                if (localStreamRef.current) {
                    getPeerMap().sendOffer(requesterId, { onCreated: sharerOnCreated });
                }
            }),
            subscribe('voice_participant_joined', (data) => {
                if (localStreamRef.current) {
                    const currentUser = userRef.current;
                    const participantId = data.user_id;
                    if (participantId !== currentUser?.id) {
                        getPeerMap().sendOffer(participantId, { onCreated: sharerOnCreated });
                    }
                }
            }),
        ];
        return () => unsubs.forEach((unsub) => unsub());
    }, [subscribe, cleanupPeerConnections, cleanupLocalStream, sharerOnCreated, userRef]);

    useEffect(() => {
        if (!isVoiceJoined && isSharing) {
            stopSharing();
        }
        if (!isVoiceJoined) {
            cleanupPeerConnections();
            setRemoteStream(null);
        }
    }, [isVoiceJoined]);

    useEffect(() => {
        return () => {
            cleanupLocalStream();
            cleanupPeerConnections();
        };
    }, [cleanupLocalStream, cleanupPeerConnections]);

    const screenshareSupported = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

    return {
        isSharing,
        isViewing,
        showPanel,
        sharerUserId,
        sharerName,
        remoteStream,
        startSharing,
        stopSharing,
        stopViewing,
        requestStream,
        screenshareSupported,
    };
}
