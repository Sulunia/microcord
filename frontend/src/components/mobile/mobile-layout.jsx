import { useState, useRef, useEffect, useCallback, useMemo } from 'preact/hooks';
import { Message } from '../chat/message.jsx';
import { MessageInput } from '../chat/message-input.jsx';
import { ScreenshareView } from '../screenshare/screenshare-view.jsx';
import { UserProfileModal } from '../sidebar/user-profile-modal.jsx';
import { UI_CONFIG, VOICE_STATE, SCROLL_TOP_THRESHOLD, SCROLL_BOTTOM_TOLERANCE, EMPTY_CONTENT_HEIGHT, GROUP_THRESHOLD_MS, MAX_CHANNEL_NAME_LENGTH } from '../../constants.js';
import styles from './mobile-layout.module.css';

function getAuthorId(msg) {
  return msg.author?.id ?? msg.author_id ?? null;
}

function getTimestamp(msg) {
  if (msg.created_at) return new Date(msg.created_at).getTime();
  return msg.timestamp || 0;
}

function MobileVoiceTab({ voice, screenshare, user, onUpdateProfile, onUploadAvatar, onLogout, channels, onDeleteChannel, usersMap }) {
  const { participants, isJoined, joinState, isMuted, isSpeaking, speakingUsers, join, leave, toggleMute, joinedElsewhere } = voice;
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatar_url]);

  const name = user?.display_name ?? '';
  const initial = name.charAt(0).toUpperCase() || 'U';
  const hasAvatar = Boolean(user?.avatar_url) && !avatarError;

  const sharingParticipant = participants.find((p) => p.sharing);
  const sharerUserId = sharingParticipant?.user_id ?? screenshare?.sharerUserId ?? null;
  const sharerName = sharingParticipant?.name;
  const someoneElseSharing = Boolean(sharerUserId) && sharerUserId !== user?.id;
  const currentlyViewing = screenshare?.isViewing;

  const isVoiceTransitioning = joinState === VOICE_STATE.JOINING || joinState === VOICE_STATE.LEAVING;
  const isBlockedByOtherDevice = joinedElsewhere && !isJoined;
  const voiceBtnLabel = isBlockedByOtherDevice
    ? 'In voice on another device'
    : joinState === VOICE_STATE.JOINING
      ? 'Joining…'
      : joinState === VOICE_STATE.LEAVING
        ? 'Leaving…'
        : isJoined
          ? 'Disconnect'
          : 'Join Voice';

  return (
    <div class={styles.voiceView}>
      <div class={`${styles.voiceChannel} has-scrollbar`}>
        <div class={styles.voiceChannelHeader}>
          <span>🔊</span>
          <span>{UI_CONFIG.voiceChannelName}</span>
        </div>
        <ul class={styles.voiceParticipantList}>
          {participants.map((p) => {
            const pid = p.user_id || p.id;
            const isSharer = pid === sharerUserId;
            const isMe = pid === user?.id;
            const canWatch = isJoined && isSharer && !isMe && !currentlyViewing;
            const pInitial = p.name.charAt(0).toUpperCase();
            const participantMuted = Boolean(p.muted);
            return (
              <li class={`${styles.participant} ${(speakingUsers.get(pid) ?? Boolean(p.speaking)) ? styles.speaking : ''}`}>
                <span class={styles.participantAvatar}>
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt={p.name} class={styles.participantAvatarImg} />
                    : pInitial}
                </span>
                <span class={styles.participantName}>
                  {p.name}
                  {isSharer && <span class={styles.sharingBadge}>sharing</span>}
                </span>
                {participantMuted && <span class={styles.mutedIcon} title="Muted">🔇</span>}
                {canWatch && (
                  <button class={styles.watchBtn} onClick={screenshare?.requestStream} title="Watch stream">▶</button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div class={styles.voiceControls}>
        <div class={styles.voiceProfileRow}>
          <button class={styles.voiceProfileBtn} type="button" onClick={() => setIsProfileOpen(true)}>
            <span class={styles.voiceProfileAvatar}>
              {hasAvatar ? (
                <img src={user.avatar_url} onError={() => setAvatarError(true)} alt={name} />
              ) : (
                <span>{initial}</span>
              )}
            </span>
            <span class={styles.voiceProfileInfo}>
              <span class={styles.voiceProfileName}>{name}</span>
              <span class={styles.voiceProfileSubtext}>Tap to edit profile</span>
            </span>
          </button>
          {isJoined && (
            <button
              class={`${styles.muteBtn} ${isMuted ? styles.muteBtnActive : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
          )}
        </div>
        <button
          class={`${styles.voiceBtn} ${isJoined ? styles.voiceBtnLeave : ''}`}
          onClick={isJoined ? leave : join}
          disabled={isVoiceTransitioning || isBlockedByOtherDevice}
        >
          {voiceBtnLabel}
        </button>
        {isJoined && screenshare?.screenshareSupported && (
          <button
            class={`${styles.voiceShareBtn} ${screenshare?.isSharing ? styles.voiceShareBtnActive : ''}`}
            onClick={screenshare?.isSharing ? screenshare.stopSharing : screenshare?.startSharing}
            disabled={someoneElseSharing}
            title={
              someoneElseSharing
                ? `${sharerName || 'Someone'} is already sharing`
                : screenshare?.isSharing ? 'Stop sharing' : 'Share your screen'
            }
          >
            {screenshare?.isSharing ? 'Stop Sharing' : 'Share Screen'}
          </button>
        )}
      </div>
      <UserProfileModal
        isOpen={isProfileOpen}
        user={user}
        isSpeaking={isSpeaking && isJoined}
        onClose={() => setIsProfileOpen(false)}
        onSave={onUpdateProfile || (() => false)}
        onUploadAvatar={onUploadAvatar}
        onLogout={onLogout}
        channels={channels}
        onDeleteChannel={onDeleteChannel}
        usersMap={usersMap}
      />
    </div>
  );
}

function MobileUserItem({ user, isOnline, isSelf, canAdmin, onAdminToggle }) {
  const name = user?.display_name || 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const hasAvatar = Boolean(user?.avatar_url);
  const badge = user?.is_owner ? '\u{1F451}' : user?.is_admin ? '\u{2B50}' : null;

  const handleAdminAction = () => {
    onAdminToggle(user.id, !user.is_admin);
  };

  const showAdminBtn = canAdmin && !user?.is_owner && !isSelf;

  return (
    <div class={`${styles.userItem} ${!isOnline ? styles.userOffline : ''}`}>
      <span class={styles.userAvatar}>
        {hasAvatar ? (
          <img src={user.avatar_url} alt={name} class={styles.userAvatarImg} />
        ) : (
          <span>{initial}</span>
        )}
        <span class={`${styles.userStatusDot} ${isOnline ? styles.userStatusOnline : styles.userStatusOffline}`} />
      </span>
      <span class={styles.userName}>{name}</span>
      {badge && <span class={styles.userBadge}>{badge}</span>}
      {showAdminBtn && (
        <button class={styles.userAdminBtn} onClick={handleAdminAction}>
          {user?.is_admin ? '✕' : '⭐'}
        </button>
      )}
    </div>
  );
}

function MobileUsersTab({ usersMap, onlineUserIds, currentUser, setUserAdmin }) {
  const allUsers = Object.values(usersMap);
  const onlineSet = onlineUserIds || new Set();
  const online = allUsers.filter((user) => onlineSet.has(user.id));
  const offline = allUsers.filter((user) => !onlineSet.has(user.id));
  const canAdmin = Boolean(currentUser?.is_admin || currentUser?.is_owner);

  return (
    <div class={`${styles.usersView} has-scrollbar`}>
      {online.length > 0 && (
        <div>
          <div class={styles.userGroupHeader}>Online — {online.length}</div>
          {online.map((user) => (
            <MobileUserItem
              key={user.id}
              user={user}
              isOnline={true}
              isSelf={user.id === currentUser?.id}
              canAdmin={canAdmin}
              onAdminToggle={setUserAdmin}
            />
          ))}
        </div>
      )}
      {offline.length > 0 && (
        <div>
          <div class={styles.userGroupHeader}>Offline — {offline.length}</div>
          {offline.map((user) => (
            <MobileUserItem
              key={user.id}
              user={user}
              isOnline={false}
              isSelf={user.id === currentUser?.id}
              canAdmin={canAdmin}
              onAdminToggle={setUserAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileChatTab({ chat, screenshare, currentUser, channelsState }) {
  const { messages, sendMessage, deleteMessage, loadOlder, hasMore, loading } = chat;
  const { channels, activeChannelId, setActiveChannelId: onSelectChannel, createChannel: onCreateChannel, renameChannel: onRenameChannel, deleteChannel: onDeleteChannel, unreadCounts } = channelsState || {};
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalName, setModalName] = useState('');
  const [modalError, setModalError] = useState(null);
  const createInputRef = useRef(null);
  const isAdmin = Boolean(currentUser?.is_admin || currentUser?.is_owner);
  const activeChannelName = channels?.find((c) => c.id === activeChannelId)?.name || 'general';

  useEffect(() => {
    if (showCreateModal && createInputRef.current) createInputRef.current.focus();
  }, [showCreateModal]);

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
      setShowChannelPicker(false);
    }
  };
  const listRef = useRef(null);
  const contentRef = useRef(null);
  const prevCountRef = useRef(0);
  const wasAtBottomRef = useRef(true);
  const bottomRef = useRef(null);
  const initialLoadDone = useRef(false);
  const scrollAnchorRef = useRef(null);

  const hasScreenshare = screenshare?.showPanel;

  const renderedMessages = useMemo(() => {
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

  const isLocal = screenshare?.isSharing;
  const onDisconnect = isLocal ? screenshare?.stopSharing : screenshare?.stopViewing;

  return (
    <div class={styles.chatView}>
      <div class={styles.channelPicker}>
        <button class={styles.channelPickerBtn} onClick={() => setShowChannelPicker(!showChannelPicker)}>
          <span>#</span> {activeChannelName}
          <span class={styles.channelPickerArrow}>{showChannelPicker ? '▲' : '▼'}</span>
        </button>
      </div>
      {showChannelPicker && (
        <div class={styles.channelDropdown}>
          {(channels || []).map((ch) => (
            <button
              key={ch.id}
              class={`${styles.channelDropdownItem} ${ch.id === activeChannelId ? styles.channelDropdownItemActive : ''}`}
              onClick={() => { onSelectChannel(ch.id); setShowChannelPicker(false); }}
            >
              # {ch.name}
              {unreadCounts?.[ch.id] ? <span class={styles.unreadBadge}>{unreadCounts[ch.id]}</span> : null}
            </button>
          ))}
          {isAdmin && (
            <button class={styles.channelDropdownAdd} onClick={() => { setShowCreateModal(true); setModalName(''); setModalError(null); }}>
              + Create Channel
            </button>
          )}
        </div>
      )}
      {hasScreenshare && (
        <div class={styles.videoSection}>
          <ScreenshareView
            stream={screenshare.remoteStream}
            sharerName={screenshare.sharerName}
            isLocal={isLocal}
            onDisconnect={onDisconnect}
          />
        </div>
      )}
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
      {showCreateModal && (
        <div class={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div class="window glass active" style={{ width: 300, '--w7-w-bg': 'var(--mc-window-glass)' }} onClick={(e) => e.stopPropagation()}>
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
                  ref={createInputRef}
                  type="text"
                  value={modalName}
                  onInput={(e) => setModalName(e.target.value)}
                  maxLength={MAX_CHANNEL_NAME_LENGTH}
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
    </div>
  );
}

export function MobileLayout({ chat, voice, screenshare, user, onUpdateProfile, onUploadAvatar, onLogout, channelsState }) {
  const [activeTab, setActiveTab] = useState('chat');

  const voiceCount = voice.participants.length;
  const onlineCount = chat.onlineUserIds ? chat.onlineUserIds.size : 0;
  const activeChannelName = channelsState?.activeChannel?.name || 'Chat';
  const totalUnread = channelsState?.unreadCounts ? Object.values(channelsState.unreadCounts).reduce((a, b) => a + b, 0) : 0;

  const tabs = [
    { id: 'chat', label: totalUnread > 0 ? `# ${activeChannelName} (${totalUnread})` : `# ${activeChannelName}` },
    { id: 'voice', label: voiceCount > 0 ? `🎤 Voice (${voiceCount})` : '🎤 Voice' },
    { id: 'users', label: `👥 Users (${onlineCount})` },
  ];

  return (
    <div class={styles.container}>
      <div class={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            class={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div class={styles.content}>
        {activeTab === 'chat' && (
          <MobileChatTab chat={chat} screenshare={screenshare} currentUser={user} channelsState={channelsState} />
        )}
        {activeTab === 'voice' && (
          <MobileVoiceTab
            voice={voice}
            screenshare={screenshare}
            user={user}
            onUpdateProfile={onUpdateProfile}
            onUploadAvatar={onUploadAvatar}
            onLogout={onLogout}
            channels={channelsState.channels}
            onDeleteChannel={channelsState.deleteChannel}
            usersMap={chat.usersMap}
          />
        )}
        {activeTab === 'users' && (
          <MobileUsersTab usersMap={chat.usersMap} onlineUserIds={chat.onlineUserIds} currentUser={user} setUserAdmin={chat.setUserAdmin} />
        )}
      </div>
    </div>
  );
}
