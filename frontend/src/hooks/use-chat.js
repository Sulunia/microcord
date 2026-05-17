import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { API_BASE, CHAT_PAGE_SIZE, NOTIFICATION_VOLUME, USER_STORAGE_KEY } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { useLatest } from './use-latest.js';
import { playNotification, tickUrl } from './audio-notifications.js';

function playTick(tickSound) {
  playNotification(tickUrl(tickSound), NOTIFICATION_VOLUME);
}

export function useChat(user, setUser, activeChannelId) {
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [usersMap, setUsersMap] = useState({});
  const [onlineUserIds, setOnlineUserIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const nextCursorRef = useRef(null);
  const userRef = useLatest(user);
  const channelIdRef = useLatest(activeChannelId);

  const userId = user?.id;

  const { subscribe } = useRealtime();

  const fetchUsers = useCallback(async () => {
    try {
      const res = await authedFetch(`${API_BASE}/users`);
      if (!res.ok) return;
      const list = await res.json();
      const map = {};
      for (const user of list) map[user.id] = user;
      setUsersMap(map);
    } catch {}
  }, []);

  const fetchMessages = useCallback(async (cursor = null, channelId = null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(CHAT_PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      if (channelId) params.set('channel_id', channelId);
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
      setLoading(false);
    }
  }, []);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingRef.current || !nextCursorRef.current) return;
    fetchMessages(nextCursorRef.current, channelIdRef.current);
  }, [hasMore, fetchMessages]);

  useEffect(() => {
    const unsubs = [
      subscribe('chat_message', (data) => {
        const author = data?.author;
        if (author?.id) {
          setUsersMap((prev) => ({ ...prev, [author.id]: author }));
        }
        const msgChannelId = data?.channel_id;
        const currentChannelId = channelIdRef.current;
        const authorId = author?.id;
        const currentId = userRef.current?.id;
        const isOtherUserMessage = authorId && authorId !== currentId;
        if (isOtherUserMessage) {
          playTick(author?.tick_sound);
        }
        if (msgChannelId && currentChannelId && msgChannelId !== currentChannelId) return;
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === data?.id);
          if (existing >= 0) {
            const updated = [...prev];
            updated[existing] = data;
            return updated;
          }
          return [...prev, data];
        });
      }),
      subscribe('chat_message_deleted', (data) => {
        const deletedId = data?.id;
        if (deletedId) {
          setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        }
      }),
      subscribe('channel_deleted', (data) => {
        const deletedChId = data?.channel_id;
        if (deletedChId && deletedChId === channelIdRef.current) {
          setMessages([]);
        }
      }),
      subscribe('user_updated', (data) => {
        const updatedUser = data?.user;
        if (updatedUser?.id) {
          setUsersMap((prev) => ({ ...prev, [updatedUser.id]: updatedUser }));
          if (updatedUser.id === user?.id && setUser) {
            const merged = { ...user, ...updatedUser };
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(merged));
            setUser(merged);
          }
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
    fetchMessages(null, activeChannelId);
  }, [userId, fetchMessages, fetchUsers, activeChannelId]);

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

    const body = { content: text, image_url };
    const chId = channelIdRef.current;
    if (chId) body.channel_id = chId;

    const res = await authedFetch(`${API_BASE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  const setUserAdmin = useCallback(async (targetUserId, isAdmin) => {
    const res = await authedFetch(`${API_BASE}/users/${targetUserId}/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_admin: isAdmin }),
    });
    if (res.ok) {
      const data = await res.json();
      setUsersMap((prev) => ({ ...prev, [data.id]: data }));
    }
  }, []);

  const hydratedMessages = messages.map((message) => ({
    ...message,
    author: message.author || usersMap[message.author_id] || null,
  }));

  return { messages: hydratedMessages, sendMessage, deleteMessage, loadOlder, hasMore, loading, usersMap, onlineUserIds, setUserAdmin };
}
