import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { API_BASE, WS_URL, CHAT_PAGE_SIZE, TICK_SOUNDS } from '../constants.js';
import { authHeaders } from './use-user.js';

const audioCache = {};
function getTickAudio(tickSound) {
  const id = tickSound ?? 1;
  if (!audioCache[id]) {
    const s = TICK_SOUNDS.find((t) => t.id === id);
    audioCache[id] = new Audio(s ? s.url : TICK_SOUNDS[0].url);
    audioCache[id].volume = id <= 3 ? 0.7 : 0.7;
  }
  return audioCache[id];
}

function playTick(tickSound) {
  const a = getTickAudio(tickSound);
  a.currentTime = 0;
  a.play().catch(() => {});
}

export function useChat(user) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [usersMap, setUsersMap] = useState({});
  const loadingRef = useRef(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const userRef = useRef(user);
  const nextCursorRef = useRef(null);

  useEffect(() => { userRef.current = user; }, [user]);

  const userId = user?.id;

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/users`, { headers: authHeaders() });
      if (!res.ok) return;
      const list = await res.json();
      const map = {};
      for (const u of list) map[u.id] = u;
      setUsersMap(map);
    } catch { /* ignore */ }
  }, []);

  const fetchMessages = useCallback(async (cursor = null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const params = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`${API_BASE}/messages?${params}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const batch = data.messages || [];
      nextCursorRef.current = data.next_cursor;
      setHasMore(data.next_cursor != null);
      if (cursor) {
        setMessages((prev) => [...batch, ...prev]);
      } else {
        setMessages(batch);
      }
    } catch { /* ignore */ } finally {
      loadingRef.current = false;
    }
  }, []);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingRef.current || !nextCursorRef.current) return;
    fetchMessages(nextCursorRef.current);
  }, [hasMore, fetchMessages]);

  const connectWs = useCallback(async () => {
    const u = userRef.current;
    if (!u) return;
    try {
      const res = await fetch(`${API_BASE}/auth/ws-ticket`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        reconnectTimer.current = setTimeout(connectWs, 2000);
        return;
      }
      const { ticket } = await res.json();
      const ws = new WebSocket(`${WS_URL}?ticket=${ticket}`);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'chat_message') {
            const author = msg.data?.author;
            if (author?.id) {
              setUsersMap((prev) => ({ ...prev, [author.id]: author }));
            }
            setMessages((prev) => [...prev, msg.data]);
            const authorId = author?.id;
            const currentId = userRef.current?.id;
            if (authorId && authorId !== currentId) {
              playTick(author?.tick_sound);
            }
          } else if (msg.type === 'user_updated') {
            const updatedUser = msg.data?.user;
            if (updatedUser?.id) {
              setUsersMap((prev) => ({ ...prev, [updatedUser.id]: updatedUser }));
            }
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connectWs, 2000);
      };

      wsRef.current = ws;
    } catch {
      reconnectTimer.current = setTimeout(connectWs, 2000);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    fetchUsers();
    fetchMessages();
    connectWs();

    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [userId, connectWs, fetchMessages, fetchUsers]);

  const sendMessage = useCallback(async (text, imageFile = null) => {
    const u = userRef.current;
    if (!u) return;
    let image_url = null;

    if (imageFile) {
      const form = new FormData();
      form.append('file', imageFile);
      const uploadRes = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      if (uploadRes.ok) {
        const data = await uploadRes.json();
        image_url = data.url;
      }
    }

    if (!text.trim() && !image_url) return;

    await fetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ content: text, image_url }),
    });

    playTick(userRef.current?.tick_sound);
  }, []);

  const hydratedMessages = messages.map((m) => ({
    ...m,
    author: m.author || usersMap[m.author_id] || null,
  }));

  return { messages: hydratedMessages, sendMessage, loadOlder, hasMore, ws: wsRef, usersMap };
}
