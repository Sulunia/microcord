import { createContext } from 'preact';
import { useState, useEffect, useCallback, useRef, useContext } from 'preact/hooks';
import { API_BASE, WS_URL } from '../constants.js';
import { authedFetch } from './use-user.js';

const RealtimeContext = createContext(null);

export function RealtimeProvider({ user, children }) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const subscribersRef = useRef(new Map());
  const userRef = useRef(user);

  useEffect(() => { userRef.current = user; }, [user]);

  const dispatch = useCallback((msg) => {
    const handlers = subscribersRef.current.get(msg.type);
    if (handlers) {
      for (const fn of handlers) {
        try { fn(msg.data); } catch {}
      }
    }
  }, []);

  const connectWs = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    try {
      const res = await authedFetch(`${API_BASE}/auth/ws-ticket`, { method: 'POST' });
      if (!res.ok) {
        reconnectTimer.current = setTimeout(connectWs, 2000);
        return;
      }
      const { ticket } = await res.json();
      const ws = new WebSocket(`${WS_URL}?ticket=${ticket}`);

      ws.onopen = () => setConnected(true);

      ws.onmessage = (e) => {
        try { dispatch(JSON.parse(e.data)); } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer.current = setTimeout(connectWs, 2000);
      };

      wsRef.current = ws;
    } catch {
      reconnectTimer.current = setTimeout(connectWs, 2000);
    }
  }, [dispatch]);

  useEffect(() => {
    if (!user?.id) return;
    connectWs();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [user?.id, connectWs]);

  const send = useCallback((type, data) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }, []);

  const subscribe = useCallback((type, handler) => {
    let set = subscribersRef.current.get(type);
    if (!set) {
      set = new Set();
      subscribersRef.current.set(type, set);
    }
    set.add(handler);
    return () => {
      const s = subscribersRef.current.get(type);
      if (s) {
        s.delete(handler);
        if (s.size === 0) subscribersRef.current.delete(type);
      }
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ send, subscribe, connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within a RealtimeProvider');
  return ctx;
}
