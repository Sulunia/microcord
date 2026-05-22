import { useEffect, useState, useRef, useCallback, useMemo } from 'preact/hooks';
import { UI_CONFIG, VOICE_STATE } from '../../constants.js';
import styles from './sidebar.module.css';
import { UserProfileModal } from './user-profile-modal.jsx';

/**
 * Build a TS2-style list: ALL voice channels in creation order,
 * each with its participants nested underneath. Channels with no
 * participants still appear (empty room).
 */
function buildChannelTree(voiceChannels, participants, activeChannelId) {
  const partsByChannel = new Map();
  for (const p of participants) {
    const cid = p.channel_id;
    if (!partsByChannel.has(cid)) partsByChannel.set(cid, []);
    partsByChannel.get(cid).push(p);
  }
  // voiceChannels is already in creation order from the API
  return (voiceChannels || []).map((vc) => ({
    id: vc.id,
    name: vc.name,
    participants: partsByChannel.get(vc.id) || [],
    isActive: vc.id === activeChannelId,
  }));
}

function Participant({ name, avatarUrl, isSpeaking, isSharer, isMuted, canWatch, onWatch, isNew }) {
  const initial = name.charAt(0).toUpperCase();
  return (
    <li class={`${styles.participant} ${isSpeaking ? styles.speaking : ''} ${isNew ? styles.participantNew : ''}`}>
      <span class={styles.participantAvatar}>
        {avatarUrl
          ? <img src={avatarUrl} alt={name} class={styles.participantAvatarImg} />
          : initial}
      </span>
      <span class={styles.participantName}>
        {name}
        {isSharer && <span class={styles.sharingBadge}>sharing</span>}
      </span>
      {isMuted && (
        <span class={styles.mutedIcon} title="Muted">🔇</span>
      )}
      {canWatch && (
        <button class={styles.watchBtn} onClick={onWatch} title="Watch stream">
          ▶
        </button>
      )}
    </li>
  );
}

export function Sidebar({ voice, user, onUpdateProfile, onUploadAvatar, onLogout, screenshare, style, channels, onDeleteChannel, usersMap, voiceChannels, onCreateVoiceChannel, onDeleteVoiceChannel, onJoinVoiceChannel }) {
  const { participants, isJoined, joinState, isMuted, isSpeaking, speakingUsers, join, leave, toggleMute, joinedElsewhere, activeChannelId, joinChannel } = voice;
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const prevIdsRef = useRef(new Set());
  const [newIds, setNewIds] = useState(new Set());

  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatar_url]);

  useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.user_id || p.id));
    const prevIds = prevIdsRef.current;
    const fresh = new Set();
    for (const id of currentIds) {
      if (!prevIds.has(id)) fresh.add(id);
    }
    if (fresh.size > 0 && prevIds.size > 0) {
      setNewIds(fresh);
      const timer = setTimeout(() => setNewIds(new Set()), 400);
      prevIdsRef.current = currentIds;
      return () => clearTimeout(timer);
    }
    prevIdsRef.current = currentIds;
  }, [participants]);

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

  const handleVoiceChannelClick = useCallback((channelId) => {
    if (!isJoined) {
      if (joinChannel) joinChannel(channelId);
    } else if (activeChannelId !== channelId) {
      leave().then(() => {
        if (joinChannel) joinChannel(channelId);
      });
    }
  }, [isJoined, activeChannelId, joinChannel, leave]);

  const channelTree = useMemo(
    () => buildChannelTree(voiceChannels, participants, activeChannelId),
    [voiceChannels, participants, activeChannelId],
  );

  return (
    <aside class={styles.sidebar} style={style}>
      <div class={`${styles.channel} has-scrollbar`}>
        <div class={styles.channelHeader}>
          <span class={styles.channelIcon}>🔊</span>
          <span class={styles.channelName}>{UI_CONFIG.voiceChannelName}</span>
        </div>

        {voiceChannels && voiceChannels.length > 0 && (
          <ul class={styles.participantList}>
            {channelTree.map((ch) => (
              <>
                <li
                  class={`${styles.channelGroupHeader} ${ch.isActive ? styles.voiceChannelActive : ''}`}
                  onClick={() => handleVoiceChannelClick(ch.id)}
                >
                  <span class={styles.channelGroupIcon}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                  </span>
                  <span class={styles.channelGroupName}>{ch.name}</span>
                  <span class={styles.voiceChannelCount}>{ch.participants.length}</span>
                </li>
                {ch.participants.map((p) => {
                  const pid = p.user_id || p.id;
                  const isSharer = pid === sharerUserId;
                  const isMe = pid === user?.id;
                  const canWatch = isJoined && isSharer && !isMe && !currentlyViewing;
                  const participantMuted = Boolean(p.muted);
                  return (
                    <Participant
                      key={pid}
                      name={p.name}
                      avatarUrl={p.avatar_url}
                      isSpeaking={speakingUsers.get(pid) ?? Boolean(p.speaking)}
                      isSharer={isSharer}
                      isMuted={participantMuted}
                      canWatch={canWatch}
                      onWatch={screenshare?.requestStream}
                      isNew={newIds.has(pid)}
                    />
                  );
                })}
              </>
            ))}
          </ul>
        )}
      </div>

      <div class={styles.controls}>
        <div class={styles.profileRow}>
          <button
            class={styles.profileButton}
            type="button"
            onClick={() => setIsProfileOpen(true)}
            title="Open profile settings"
          >
            <span class={styles.profileAvatar}>
              {hasAvatar ? (
                <img
                  src={user.avatar_url}
                  onError={() => setAvatarError(true)}
                  alt={name}
                />
              ) : (
                <span>{initial}</span>
              )}
            </span>
            <span class={styles.profileInfo}>
              <span class={styles.profileName}>{name}</span>
              <span class={styles.profileSubtext}>Click to edit display name</span>
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
            class={`${styles.shareBtn} ${screenshare?.isSharing ? styles.shareBtnActive : ''}`}
            onClick={screenshare?.isSharing ? screenshare.stopSharing : screenshare?.startSharing}
            disabled={someoneElseSharing}
            title={
              someoneElseSharing
                ? `${sharerName || 'Someone'} is already sharing`
                : screenshare?.isSharing
                  ? 'Stop sharing'
                  : 'Share your screen'
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
        voiceChannels={voiceChannels}
        onCreateVoiceChannel={onCreateVoiceChannel}
        onDeleteVoiceChannel={onDeleteVoiceChannel}
      />
    </aside>
  );
}
