import { useState, useRef, useEffect, useCallback, useMemo } from 'preact/hooks';
import { Message } from './message.jsx';
import { MessageInput } from './message-input.jsx';
import { ScreenshareView } from '../screenshare/screenshare-view.jsx';
import { SCROLL_TOP_THRESHOLD, SCROLL_BOTTOM_TOLERANCE, EMPTY_CONTENT_HEIGHT, GROUP_THRESHOLD_MS, DEFAULT_VIDEO_RATIO, MIN_VIDEO_RATIO, MAX_VIDEO_RATIO, MAX_CHANNEL_NAME_LENGTH } from '../../constants.js';
import styles from './chat-panel.module.css';

function getAuthorId(msg) {
  return msg.author?.id ?? msg.author_id ?? null;
}

function getTimestamp(msg) {
  if (msg.created_at) return new Date(msg.created_at).getTime();
  return msg.timestamp || 0;
}

export function ChatPanel({ chat, screenshare, currentUser, showMembers, onToggleMembers, channels, activeChannelId, onSelectChannel, onCreateChannel, onRenameChannel, onDeleteChannel, unreadCounts }) {
  const { messages, sendMessage, deleteMessage, loadOlder, hasMore, loading } = chat;
  const listRef = useRef(null);
  const contentRef = useRef(null);
  const prevCountRef = useRef(0);
  const wasAtBottomRef = useRef(true);
  const bottomRef = useRef(null);
  const panelRef = useRef(null);
  const initialLoadDone = useRef(false);
  const scrollAnchorRef = useRef(null);

  const [videoRatio, setVideoRatio] = useState(DEFAULT_VIDEO_RATIO);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState(null);
  const [editName, setEditName] = useState('');
  const [modalName, setModalName] = useState('');
  const [modalError, setModalError] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
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
          deletable={currentUser && getAuthorId(msg) === currentUser.id}
          onDelete={deleteMessage}
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
        bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
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

    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
  }, [messages.length]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !hasMore) return;

    requestAnimationFrame(() => {
      if (el.scrollHeight <= el.clientHeight + EMPTY_CONTENT_HEIGHT) {
        loadOlder();
      }
    });
  }, [messages.length, hasMore, loadOlder]);

  useEffect(() => {
    const el = listRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (wasAtBottomRef.current) {
        bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'instant' });
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;

    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_TOLERANCE;

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

  const isAdmin = Boolean(currentUser?.is_admin || currentUser?.is_owner);
  const activeChannelName = channels?.find((c) => c.id === activeChannelId)?.name || 'general';

  const handleTabContextMenu = useCallback((e, channel) => {
    if (!isAdmin) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channel });
  }, [isAdmin]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  const handleCreate = async () => {
    setModalError(null);
    const name = modalName.trim();
    if (!name || name.length > MAX_CHANNEL_NAME_LENGTH) {
      setModalError('Name must be 1-40 characters');
      return;
    }
    const result = await onCreateChannel(name);
    if (result) {
      setShowCreateModal(false);
      setModalName('');
    }
  };

  const handleRename = async () => {
    setModalError(null);
    const name = editName.trim();
    if (!name || name.length > MAX_CHANNEL_NAME_LENGTH) {
      setModalError('Name must be 1-40 characters');
      return;
    }
    const result = await onRenameChannel(editingChannelId, name);
    if (result) {
      setEditingChannelId(null);
      setEditName('');
    }
  };

  const handleDelete = async (channelId) => {
    await onDeleteChannel(channelId);
    setContextMenu(null);
  };

  const isLocal = screenshare?.isSharing;
  const onDisconnect = isLocal ? screenshare?.stopSharing : screenshare?.stopViewing;

  return (
    <main class={styles.panel} ref={panelRef}>
      <div class={styles.header}>
        <menu role="tablist" class={styles.tablist}>
          {(channels || []).map((ch) => (
            <button
              key={ch.id}
              role="tab"
              aria-selected={ch.id === activeChannelId}
              class={`${styles.tab} ${ch.id === activeChannelId ? styles.tabActive : ''} ${unreadCounts?.[ch.id] ? styles.tabUnread : ''}`}
              onClick={() => onSelectChannel(ch.id)}
              onContextMenu={(e) => handleTabContextMenu(e, ch)}
            >
              <span class={styles.hash}>#</span> {ch.name}
            </button>
          ))}
          {isAdmin && (
            <button role="tab" class={styles.addTab} title="Add channel" onClick={() => { setShowCreateModal(true); setModalName(''); setModalError(null); }}>+</button>
          )}
        </menu>
        <button
          class={`${styles.membersBtn} ${showMembers ? styles.membersBtnActive : ''}`}
          onClick={onToggleMembers}
          title={showMembers ? 'Hide members' : 'Show members'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </button>
      </div>
      {contextMenu && !contextMenu.channel.is_default && (
        <div class={styles.contextMenu} style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y }}>
          <button class={styles.contextItem} onClick={() => { setEditingChannelId(contextMenu.channel.id); setEditName(contextMenu.channel.name); setModalError(null); setContextMenu(null); }}>Rename</button>
          <button class={`${styles.contextItem} ${styles.contextItemDanger}`} onClick={() => handleDelete(contextMenu.channel.id)}>Delete</button>
        </div>
      )}
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
        <div class={`${styles.messageList} has-scrollbar`} ref={listRef} onScroll={onScroll}>
          <div ref={contentRef} class={styles.messageContent}>
            {loading && messages.length === 0 ? (
              <div class={styles.loading}>
                <progress />
              </div>
            ) : renderedMessages}
            <div ref={bottomRef} />
          </div>
        </div>
        <MessageInput onSend={sendMessage} channelName={activeChannelName} />
      </div>
      {showCreateModal && (
        <div class={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div class="window glass active" style={{ width: 340, '--w7-w-bg': 'var(--mc-window-glass)' }} onClick={(e) => e.stopPropagation()}>
            <div class="title-bar">
              <div class="title-bar-text">Create Channel</div>
              <div class="title-bar-controls">
                <button aria-label="Close" onClick={() => setShowCreateModal(false)} />
              </div>
            </div>
            <div class="window-body has-space">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.82rem' }}>Channel Name</label>
                <input
                  type="text"
                  value={modalName}
                  onInput={(e) => setModalName(e.target.value)}
                  maxLength={MAX_CHANNEL_NAME_LENGTH}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                />
                {modalError && <div style={{ color: 'var(--mc-danger)', fontSize: '0.78rem' }}>{modalError}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 4 }}>
                  <button onClick={() => setShowCreateModal(false)}>Cancel</button>
                  <button onClick={handleCreate}>Create</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingChannelId && (
        <div class={styles.modalOverlay} onClick={() => setEditingChannelId(null)}>
          <div class="window glass active" style={{ width: 340, '--w7-w-bg': 'var(--mc-window-glass)' }} onClick={(e) => e.stopPropagation()}>
            <div class="title-bar">
              <div class="title-bar-text">Rename Channel</div>
              <div class="title-bar-controls">
                <button aria-label="Close" onClick={() => setEditingChannelId(null)} />
              </div>
            </div>
            <div class="window-body has-space">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.82rem' }}>Channel Name</label>
                <input
                  type="text"
                  value={editName}
                  onInput={(e) => setEditName(e.target.value)}
                  maxLength={MAX_CHANNEL_NAME_LENGTH}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
                />
                {modalError && <div style={{ color: 'var(--mc-danger)', fontSize: '0.78rem' }}>{modalError}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 4 }}>
                  <button onClick={() => setEditingChannelId(null)}>Cancel</button>
                  <button onClick={handleRename}>Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
