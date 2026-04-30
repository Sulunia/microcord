import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { API_BASE, CHAT_PAGE_SIZE, TICK_SOUNDS } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';

const audioCache = {};
function getTickAudio(tickSound) {
  const id = tickSound ?? 1;
  if (!audioCache[id]) {
    const s = TICK_SOUNDS.find((t) => t.id === id);
    audioCache[id] = new Audio(s ? s.url : TICK_SOUNDS[0].url);
    audioCache[id].volume = 0.7;
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
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const loadingRef = useRef(false);
  const nextCursorRef = useRef(null);
  const userRef = useRef(user);

  useEffect(() => { userRef.current = user; }, [user]);

  const userId = user?.id;

  const { subscribe } = useRealtime();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authedFetch(`${API_BASE}/users`);
      if (!res.ok) return;
      const list = await res.json();
      const map = {};
      for (const u of list) map[u.id] = u;
      setUsersMap(map);
    } catch {}
  }, []);

  const fetchMessages = useCallback(async (cursor = null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const params = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const res = await authedFetch(`${API_BASE}/messages?${params}`);
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
    } catch {} finally {
      loadingRef.current = false;
    }
  }, []);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingRef.current || !nextCursorRef.current) return;
    fetchMessages(nextCursorRef.current);
  }, [hasMore, fetchMessages]);

  useEffect(() => {
    const unsubs = [
      subscribe('chat_message', (data) => {
        const author = data?.author;
        if (author?.id) {
          setUsersMap((prev) => ({ ...prev, [author.id]: author }));
        }
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === data?.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data;
            return updated;
          }
          return [...prev, data];
        });
        const authorId = author?.id;
        const currentId = userRef.current?.id;
        if (authorId && authorId !== currentId) {
          playTick(author?.tick_sound);
        }
      }),
      subscribe('chat_message_deleted', (data) => {
        const deletedId = data?.id;
        if (deletedId) {
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      }),
      subscribe('user_updated', (data) => {
        const updatedUser = data?.user;
        if (updatedUser?.id) {
          setUsersMap((prev) => ({ ...prev, [updatedUser.id]: updatedUser }));
        }
      }),
      subscribe('presence_init', (data) => {
        const ids = data?.user_ids;
        if (Array.isArray(ids)) {
          setOnlineUserIds(new Set(ids));
        }
      }),
      subscribe('presence_online', (data) => {
        const uid = data?.user_id;
        const onlineUser = data?.user;
        if (uid) {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            next.add(uid);
            return next;
          });
          if (onlineUser?.id) {
            setUsersMap((prev) => {
              if (prev[onlineUser.id]) return prev;
              return { ...prev, [onlineUser.id]: onlineUser };
            });
          }
        }
      }),
      subscribe('presence_offline', (data) => {
        const uid = data?.user_id;
        if (uid) {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            next.delete(uid);
            return next;
          });
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  useEffect(() => {
    if (!userId) return;
    fetchUsers();
    fetchMessages();
  }, [userId, fetchMessages, fetchUsers]);

  const sendMessage = useCallback(async (text, imageFile = null) => {
    const u = userRef.current;
    if (!u) return;
    let image_url = null;

    if (imageFile) {
      const form = new FormData();
      form.append('file', imageFile);
      const uploadRes = await authedFetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: form,
      });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploadData = await uploadRes.json();
      image_url = uploadData.url;
    }

    if (!text.trim() && !image_url) return;

    const res = await authedFetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, image_url }),
    });

    if (!res.ok) throw new Error('Send failed');

    if (res.ok) {
      const msgData = await res.json();
      if (image_url) {
        setMessages((prev) => [...prev, { ...msgData, pending: true }]);
      }
    }

    playTick(userRef.current?.tick_sound);
  }, []);

  const deleteMessage = useCallback(async (messageId) => {
    const res = await authedFetch(`${API_BASE}/messages/${messageId}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      const { id } = await res.json();
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
  }, []);

  const hydratedMessages = messages.map((m) => ({
    ...m,
    author: m.author || usersMap[m.author_id] || null,
  }));

  return { messages: hydratedMessages, sendMessage, deleteMessage, loadOlder, hasMore, usersMap, onlineUserIds };
}
