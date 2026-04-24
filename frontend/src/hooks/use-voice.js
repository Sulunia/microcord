import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { API_BASE } from '../constants.js';
import { authHeaders } from './use-user.js';

const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function useVoice(user, wsRef) {
  const [participants, setParticipants] = useState([]);
  const [isJoined, setIsJoined] = useState(false);
  const streamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const userRef = useRef(user);
  const isJoinedRef = useRef(false);

  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isJoinedRef.current = isJoined; }, [isJoined]);

  const userId = user?.id;

  useEffect(() => {
    fetch(`${API_BASE}/voice/config`, { headers: authHeaders() })
      .then((r) => r.ok ? r.json() : null)
      .then((cfg) => { if (cfg?.ice_servers) iceServersRef.current = cfg.ice_servers; })
      .catch(() => {});
  }, []);

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
      } else {
        const audio = new Audio();
        audio.autoplay = true;
        audio.volume = 1.0;
        const outputDeviceId = localStorage.getItem('mc-audio-output');
        if (outputDeviceId && audio.setSinkId) {
          audio.setSinkId(outputDeviceId).catch(() => {});
        }
        audio.srcObject = remoteStream;
        audioElementsRef.current.set(targetId, { audio, volume: 1.0 });
      }
    };

    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }, [sendSignal]);

  const sendOffer = useCallback(async (targetId) => {
    const pc = createPC(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(targetId, { type: 'offer', sdp: offer.sdp });
  }, [createPC, sendSignal]);

  const handleSignal = useCallback(async (fromId, signal) => {
    switch (signal.type) {
      case 'offer': {
        const pc = createPC(fromId);
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(fromId, { type: 'answer', sdp: answer.sdp });
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
  }, [createPC, sendSignal]);

  useEffect(() => {
    if (!wsRef?.current) return;
    const ws = wsRef.current;

    const onMessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      switch (msg.type) {
        case 'voice_participant_joined':
          fetchParticipants();
          break;
        case 'voice_participant_left': {
          const pid = msg.data.user_id;
          const pc = peerConnectionsRef.current.get(pid);
          if (pc) { pc.close(); peerConnectionsRef.current.delete(pid); }
          const entry = audioElementsRef.current.get(pid);
          if (entry) { entry.audio.pause(); entry.audio.srcObject = null; audioElementsRef.current.delete(pid); }
          fetchParticipants();
          break;
        }
        case 'voice_signal': {
          const { from, signal } = msg.data;
          if (isJoinedRef.current) handleSignal(from, signal);
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
    audioElementsRef.current.forEach(({ audio }) => { audio.pause(); audio.srcObject = null; });
    audioElementsRef.current.clear();
  }, []);

  const cleanup = useCallback(() => {
    cleanupPeerConnections();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [cleanupPeerConnections]);

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
      const inputDeviceId = localStorage.getItem('mc-audio-input');
      const audioConstraints = inputDeviceId
        ? { deviceId: { exact: inputDeviceId } }
        : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      streamRef.current = stream;

      const res = await fetch(`${API_BASE}/voice/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Join failed');

      const { participants: pList } = await res.json();
      setParticipants(pList);
      setIsJoined(true);

      for (const p of pList) {
        const pid = p.user_id || p.id;
        if (pid === u.id) continue;
        await sendOffer(pid);
      }
    } catch (err) {
      console.error('Voice join error:', err);
      cleanup();
    }
  }, [isJoined, cleanup, sendOffer]);

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

  const setVolume = useCallback((uid, volume) => {
    const entry = audioElementsRef.current.get(uid);
    if (entry) {
      entry.volume = volume;
      entry.audio.volume = volume;
    }
  }, []);

  return { participants, isJoined, join, leave, setVolume, fetchParticipants };
}
