import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { API_BASE } from '../constants.js';
import { authedFetch } from './use-user.js';
import { useRealtime } from './realtime.jsx';
import { useLatest } from './use-latest.js';

export function useChannels() {
  const [channels, setChannels] = useState([]);
  const [activeChannelId, setActiveChannelId] = useState(null);
  const [error, setError] = useState(null);
  const initialLoadDone = useRef(false);
  const activeChannelIdRef = useLatest(activeChannelId);

  const { subscribe } = useRealtime();

  const fetchChannels = useCallback(async () => {
    try {
      const res = await authedFetch(`${API_BASE}/channels`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.channels || [];
      setChannels(list);
      if (!initialLoadDone.current) {
        initialLoadDone.current = true;
        const defaultCh = list.find((c) => c.is_default);
        setActiveChannelId(defaultCh?.id || list[0]?.id || null);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe('presence_init', (data) => {
        const chs = data?.channels;
        if (Array.isArray(chs) && chs.length > 0) {
          setChannels(chs);
          if (!activeChannelIdRef.current) {
            const defaultCh = chs.find((c) => c.is_default);
            setActiveChannelId(defaultCh?.id || chs[0]?.id || null);
          }
        }
      }),
      subscribe('channel_created', (data) => {
        const ch = data?.channel;
        if (ch) setChannels((prev) => [...prev, ch]);
      }),
      subscribe('channel_updated', (data) => {
        const ch = data?.channel;
        if (ch) {
          setChannels((prev) => prev.map((c) => (c.id === ch.id ? ch : c)));
        }
      }),
      subscribe('channel_deleted', (data) => {
        const deletedId = data?.channel_id;
        if (deletedId) {
          setChannels((prev) => {
            const next = prev.filter((c) => c.id !== deletedId);
            if (deletedId === activeChannelIdRef.current && next.length > 0) {
              const defaultCh = next.find((c) => c.is_default);
              setActiveChannelId(defaultCh?.id || next[0]?.id);
            }
            return next;
          });
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const createChannel = useCallback(async (name) => {
    setError(null);
    try {
      const res = await authedFetch(`${API_BASE}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to create channel');
        return null;
      }
      const ch = await res.json();
      setActiveChannelId(ch.id);
      setError(null);
      return ch;
    } catch {
      setError('Failed to create channel');
      return null;
    }
  }, []);

  const renameChannel = useCallback(async (channelId, name) => {
    setError(null);
    try {
      const res = await authedFetch(`${API_BASE}/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to rename channel');
        return null;
      }
      const ch = await res.json();
      setError(null);
      return ch;
    } catch {
      setError('Failed to rename channel');
      return null;
    }
  }, []);

  const deleteChannel = useCallback(async (channelId) => {
    setError(null);
    try {
      const res = await authedFetch(`${API_BASE}/channels/${channelId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to delete channel');
        return false;
      }
      setError(null);
      return true;
    } catch {
      setError('Failed to delete channel');
      return false;
    }
  }, []);

  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

  return {
    channels,
    activeChannelId,
    activeChannel,
    setActiveChannelId,
    createChannel,
    renameChannel,
    deleteChannel,
    error,
    clearError: () => setError(null),
  };
}
