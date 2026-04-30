import { createContext } from 'preact';
import { useState, useEffect, useCallback, useRef, useContext } from 'preact/hooks';
import { API_BASE, WS_URL } from '../constants.js';
import { authedFetch } from './use-user.js';

/**
 * Shared context for the realtime WebSocket layer.
 * Exposes `{ send, subscribe, connected }` to all descendant components.
 */
const RealtimeContext = createContext(null);

/**
 * Manages the WebSocket lifecycle and provides a pub/sub interface for
 * all realtime events (chat, voice, screenshare, presence, etc.).
 *
 * Connects automatically when `user.id` is truthy, reconnects on close
 * with a 2-second back-off, and tears down on unmount or user change.
 *
 * @param {{ user: { id: string } | null, children: import('preact').ComponentChildren }} props
 */
export function RealtimeProvider({ user, children }) {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(/** @type {WebSocket | null} */ (null));
  const reconnectTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const subscribersRef = useRef(new Map());
  const userRef = useRef(user);

  useEffect(() => { userRef.current = user; }, [user]);

  /**
   * Dispatch an incoming message to all subscribers registered for its type.
   * @param {{ type: string, data: unknown }} message
   */
  const dispatch = useCallback((message) => {
    const handlers = subscribersRef.current.get(message.type);
    if (handlers) {
      for (const handler of handlers) {
        try { handler(message.data); } catch {}
      }
    }
  }, []);

  /** Fetch a WS ticket, open the socket, and wire up lifecycle handlers. */
  const connectSocket = useCallback(async () => {
    const currentUser = userRef.current;
    if (!currentUser) return;
    try {
      const response = await authedFetch(`${API_BASE}/auth/ws-ticket`, { method: 'POST' });
      if (!response.ok) {
        reconnectTimerRef.current = setTimeout(connectSocket, 2000);
        return;
      }
      const { ticket } = await response.json();
      const socket = new WebSocket(`${WS_URL}?ticket=${ticket}`);

      socket.onopen = () => setConnected(true);

      socket.onmessage = (event) => {
        try { dispatch(JSON.parse(event.data)); } catch {}
      };

      socket.onclose = () => {
        setConnected(false);
        reconnectTimerRef.current = setTimeout(connectSocket, 2000);
      };

      socketRef.current = socket;
    } catch {
      reconnectTimerRef.current = setTimeout(connectSocket, 2000);
    }
  }, [dispatch]);

  useEffect(() => {
    if (!user?.id) return;
    connectSocket();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user?.id, connectSocket]);

  /**
   * Send a typed message to the server.
   * Silently drops the message when the socket is not open.
   *
   * @param {string} type - Event type (e.g. `"chat_message"`, `"voice_signal"`).
   * @param {unknown} data - Payload to send.
   */
  const send = useCallback((type, data) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type, data }));
    }
  }, []);

  /**
   * Register a handler for a given event type.
   *
   * @param {string}   type    - Event type to listen for.
   * @param {(data: unknown) => void} handler - Called each time a matching message arrives.
   * @returns {() => void} Unsubscribe function.
   */
  const subscribe = useCallback((type, handler) => {
    let handlers = subscribersRef.current.get(type);
    if (!handlers) {
      handlers = new Set();
      subscribersRef.current.set(type, handlers);
    }
    handlers.add(handler);
    return () => {
      const existing = subscribersRef.current.get(type);
      if (existing) {
        existing.delete(handler);
        if (existing.size === 0) subscribersRef.current.delete(type);
      }
    };
  }, []);

  return (
    <RealtimeContext.Provider value={{ send, subscribe, connected }}>
      {children}
    </RealtimeContext.Provider>
  );
}

/**
 * Hook that returns the realtime context value.
 * Must be called inside a `<RealtimeProvider>`.
 *
 * @returns {{ send: (type: string, data: unknown) => void, subscribe: (type: string, handler: (data: unknown) => void) => () => void, connected: boolean }}
 */
export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtime must be used within a RealtimeProvider');
  return context;
}
