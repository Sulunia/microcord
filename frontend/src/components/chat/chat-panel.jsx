import { useState, useRef, useEffect, useCallback, useMemo } from 'preact/hooks';
import { Message } from './message.jsx';
import { MessageInput } from './message-input.jsx';
import { ScreenshareView } from '../screenshare/screenshare-view.jsx';
import styles from './chat-panel.module.css';

const SCROLL_TOP_THRESHOLD = 40;
const DEFAULT_VIDEO_RATIO = 0.5;
const MIN_VIDEO_RATIO = 0.15;
const MAX_VIDEO_RATIO = 0.85;
const GROUP_THRESHOLD_MS = 60_000;

function getAuthorId(msg) {
  return msg.author?.id ?? msg.author_id ?? null;
}

function getTimestamp(msg) {
  if (msg.created_at) return new Date(msg.created_at).getTime();
  return msg.timestamp || 0;
}

export function ChatPanel({ chat, screenshare }) {
  const { messages, sendMessage, loadOlder, hasMore } = chat;
  const listRef = useRef(null);
  const prevCountRef = useRef(0);
  const wasAtBottomRef = useRef(true);
  const panelRef = useRef(null);
  const initialLoadDone = useRef(false);
  const scrollAnchorRef = useRef(null);

  const [videoRatio, setVideoRatio] = useState(DEFAULT_VIDEO_RATIO);
  const dragging = useRef(false);

  const hasScreenshare = screenshare?.showPanel;

  const renderedMessages = useMemo(() => {
    const count = messages.length;
    return messages.map((msg, i) => {
      const prev = i > 0 ? messages[i - 1] : null;
      const sameAuthor = prev && getAuthorId(msg) && getAuthorId(msg) === getAuthorId(prev);
      const withinTime = prev && (getTimestamp(msg) - getTimestamp(prev)) < GROUP_THRESHOLD_MS;
      const grouped = sameAuthor && withinTime;
      const isNew = initialLoadDone.current && i >= prevCountRef.current;
      return (
        <Message
          key={msg.id}
          message={msg}
          grouped={grouped}
          animate={isNew && !grouped}
        />
      );
    });
  }, [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const oldCount = prevCountRef.current;
    const newCount = messages.length;
    prevCountRef.current = newCount;

    if (!initialLoadDone.current && newCount > 0) {
      initialLoadDone.current = true;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return;
    }

    if (newCount > oldCount && oldCount > 0) {
      const anchor = scrollAnchorRef.current;
      if (anchor != null) {
        scrollAnchorRef.current = null;
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - anchor;
        });
        return;
      }
    }

    if (!wasAtBottomRef.current) return;

    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !hasMore) return;

    requestAnimationFrame(() => {
      if (el.scrollHeight <= el.clientHeight + 8) {
        loadOlder();
      }
    });
  }, [messages.length, hasMore, loadOlder]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;

    if (el.scrollTop < SCROLL_TOP_THRESHOLD && hasMore) {
      scrollAnchorRef.current = el.scrollHeight;
      loadOlder();
    }
  }, [hasMore, loadOlder]);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev) => {
      if (!dragging.current) return;
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const ratio = (ev.clientY - rect.top) / rect.height;
      setVideoRatio(Math.min(MAX_VIDEO_RATIO, Math.max(MIN_VIDEO_RATIO, ratio)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const isLocal = screenshare?.isSharing;
  const onDisconnect = isLocal ? screenshare?.stopSharing : screenshare?.stopViewing;

  return (
    <main class={styles.panel} ref={panelRef}>
      {hasScreenshare && (
        <>
          <div class={styles.videoSection} style={{ height: `${videoRatio * 100}%` }}>
            <ScreenshareView
              stream={screenshare.remoteStream}
              sharerName={screenshare.sharerName}
              isLocal={isLocal}
              onDisconnect={onDisconnect}
            />
          </div>
          <div class={styles.splitHandle} onMouseDown={onMouseDown} />
        </>
      )}
      <div class={styles.chatSection} style={hasScreenshare ? { height: `${(1 - videoRatio) * 100}%` } : undefined}>
        <div class={styles.messageList} ref={listRef} onScroll={onScroll}>
          {renderedMessages}
        </div>
        <MessageInput onSend={sendMessage} />
      </div>
    </main>
  );
}
