import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { LIVE_MEDIA_CONFIG } from '../constants.js';
import { useRealtime } from './realtime.jsx';

function getDisplayConstraints() {
    const s = LIVE_MEDIA_CONFIG.screenshare;
    return {
        video: {
            width: { ideal: s.width },
            height: { ideal: s.height },
            frameRate: { ideal: s.frameRate },
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
  const peerConnectionsRef = useRef(new Map());
  const userRef = useRef(user);
  const suppressSharerSyncRef = useRef(false);

  const { send, subscribe, connected } = useRealtime();

  useEffect(() => { userRef.current = user; }, [user]);

  const isViewing = Boolean(sharerUserId) && Boolean(remoteStream) && !isSharing;
  const showPanel = isVoiceJoined && Boolean(sharerUserId) && (isSharing || !dismissed);
  const sharerName = voiceParticipants.find((p) => p.user_id === sharerUserId)?.name;

  useEffect(() => {
    if (isSharing) return;
    if (suppressSharerSyncRef.current) {
      suppressSharerSyncRef.current = false;
      return;
    }
    const sharer = voiceParticipants.find((p) => p.sharing);
    if (sharer) {
      setSharerUserId((prev) => prev === sharer.user_id ? prev : sharer.user_id);
    } else {
      setSharerUserId(null);
    }
  }, [voiceParticipants, isSharing]);

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
  }, []);

  const cleanupLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, []);

  const createPC = useCallback((targetId, stream) => {
    const existing = peerConnectionsRef.current.get(targetId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection({ iceServers: LIVE_MEDIA_CONFIG.iceServers });
    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      send('screenshare_signal', { target: targetId, signal: { type: 'ice-candidate', candidate: e.candidate } });
    };
    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, [send]);

  const sendOffer = useCallback(async (targetId, stream) => {
    const pc = createPC(targetId, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send('screenshare_signal', { target: targetId, signal: { type: 'offer', sdp: offer.sdp } });
  }, [createPC, send]);

  const handleScreenshareSignal = useCallback(async (fromId, signal) => {
    switch (signal.type) {
      case 'offer': {
        const pc = createPC(fromId, null);
        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0] || new MediaStream([event.track]));
        };
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send('screenshare_signal', { target: fromId, signal: { type: 'answer', sdp: answer.sdp } });
        break;
      }
      case 'answer': {
        const pc = peerConnectionsRef.current.get(fromId);
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
        }
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
  }, [createPC, send]);

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
    const u = userRef.current;
    if (!u || !isVoiceJoined || isSharing) return;
    if (sharerUserId) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(getDisplayConstraints());
      localStreamRef.current = stream;

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopSharing();
      });

      if (!connected) throw new Error('WS not connected');
      send('screenshare_start');

      setIsSharing(true);
      setSharerUserId(u.id);
      setRemoteStream(stream);

      for (const p of voiceParticipants) {
        const pid = p.user_id || p.id;
        if (pid === u.id) continue;
        await sendOffer(pid, stream);
      }
    } catch (err) {
      if (err.name !== 'NotAllowedError') {
        console.error('Screenshare start error:', err);
      }
      cleanupLocalStream();
      cleanupPeerConnections();
    }
  }, [isVoiceJoined, isSharing, sharerUserId, connected, send, voiceParticipants, sendOffer, stopSharing, cleanupLocalStream, cleanupPeerConnections]);

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
        handleScreenshareSignal(data.from, data.signal);
      }),
      subscribe('screenshare_request', (data) => {
        const requesterId = data.user_id;
        if (localStreamRef.current) {
          sendOffer(requesterId, localStreamRef.current);
        }
      }),
      subscribe('voice_participant_joined', (data) => {
        if (localStreamRef.current) {
          const u = userRef.current;
          const pid = data.user_id;
          if (pid !== u?.id) {
            sendOffer(pid, localStreamRef.current);
          }
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, handleScreenshareSignal, cleanupPeerConnections, cleanupLocalStream, sendOffer]);

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
  };
}
