import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { LIVE_MEDIA_CONFIG } from '../constants.js';

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

export function useScreenshare(user, wsRef, voiceParticipants, isVoiceJoined) {
  const [isSharing, setIsSharing] = useState(false);
  const [sharerUserId, setSharerUserId] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const userRef = useRef(user);

  useEffect(() => { userRef.current = user; }, [user]);

  const isViewing = Boolean(sharerUserId) && Boolean(remoteStream) && !isSharing;
  const showPanel = isVoiceJoined && Boolean(sharerUserId) && (isSharing || !dismissed);
  const sharerName = voiceParticipants.find((p) => p.user_id === sharerUserId)?.name;

  useEffect(() => {
    if (isSharing) return;
    const sharer = voiceParticipants.find((p) => p.sharing);
    if (sharer) {
      setSharerUserId((prev) => prev === sharer.user_id ? prev : sharer.user_id);
    } else {
      setSharerUserId(null);
    }
  }, [voiceParticipants, isSharing]);

  const createPC = useCallback((targetId, stream) => {
    const existing = peerConnectionsRef.current.get(targetId);
    if (existing) existing.close();

    const pc = new RTCPeerConnection();
    if (stream) {
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    }
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const ws = wsRef?.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'screenshare_signal',
          data: { target: targetId, signal: { type: 'ice-candidate', candidate: e.candidate } },
        }));
      }
    };
    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, [wsRef]);

  const sendOffer = useCallback(async (targetId, stream) => {
    const pc = createPC(targetId, stream);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const ws = wsRef?.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'screenshare_signal',
        data: { target: targetId, signal: { type: 'offer', sdp: offer.sdp } },
      }));
    }
  }, [createPC, wsRef]);

  const cleanupPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
  }, []);

  const cleanupLocalStream = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }, []);

  const stopSharing = useCallback(() => {
    cleanupLocalStream();
    cleanupPeerConnections();

    const ws = wsRef?.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'screenshare_stop' }));
    }

    setIsSharing(false);
    setSharerUserId(null);
    setRemoteStream(null);
  }, [wsRef, cleanupLocalStream, cleanupPeerConnections]);

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

      const ws = wsRef?.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WS not connected');
      ws.send(JSON.stringify({ type: 'screenshare_start' }));

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
  }, [isVoiceJoined, isSharing, sharerUserId, wsRef, voiceParticipants, sendOffer, stopSharing, cleanupLocalStream, cleanupPeerConnections]);

  const stopViewing = useCallback(() => {
    cleanupPeerConnections();
    setRemoteStream(null);
    setDismissed(true);
  }, [cleanupPeerConnections]);

  const requestStream = useCallback(() => {
    if (!sharerUserId || isSharing) return;
    setDismissed(false);
    const ws = wsRef?.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'screenshare_request' }));
    }
  }, [sharerUserId, isSharing, wsRef]);

  useEffect(() => {
    if (!wsRef?.current) return;
    const ws = wsRef.current;

    const onMessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'screenshare_start': {
          setSharerUserId(msg.data.user_id);
          setDismissed(false);
          break;
        }
        case 'screenshare_stop': {
          cleanupPeerConnections();
          setSharerUserId(null);
          setRemoteStream(null);
          break;
        }
        case 'screenshare_error': {
          console.error('Screenshare error:', msg.data.error);
          cleanupLocalStream();
          cleanupPeerConnections();
          setIsSharing(false);
          break;
        }
        case 'screenshare_signal': {
          const { from, signal } = msg.data;
          _handleSignal(from, signal);
          break;
        }
        case 'screenshare_request': {
          const requesterId = msg.data.user_id;
          if (localStreamRef.current) {
            sendOffer(requesterId, localStreamRef.current);
          }
          break;
        }
        case 'voice_participant_joined': {
          if (localStreamRef.current) {
            const u = userRef.current;
            const pid = msg.data.user_id;
            if (pid !== u?.id) {
              sendOffer(pid, localStreamRef.current);
            }
          }
          break;
        }
      }
    };

    const _handleSignal = async (fromId, signal) => {
      switch (signal.type) {
        case 'offer': {
          const pc = createPC(fromId, null);
          pc.ontrack = (event) => {
            setRemoteStream(event.streams[0] || new MediaStream([event.track]));
          };
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const ws = wsRef?.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'screenshare_signal',
              data: { target: fromId, signal: { type: 'answer', sdp: answer.sdp } },
            }));
          }
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
    };

    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [wsRef?.current, createPC, sendOffer, cleanupPeerConnections, cleanupLocalStream]);

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
