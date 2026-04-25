import { useEffect, useState, useRef } from 'preact/hooks';
import { UI_CONFIG } from '../../constants.js';
import styles from './sidebar.module.css';
import { UserProfileModal } from './user-profile-modal.jsx';

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

export function Sidebar({ voice, user, onUpdateProfile, onUploadAvatar, onLogout, screenshare, style }) {
  const { participants, isJoined, isMuted, isSpeaking, speakingUsers, join, leave, toggleMute } = voice;
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

  const name = user?.display_name ?? user?.name ?? '';
  const initial = name.charAt(0).toUpperCase() || 'U';
  const hasAvatar = Boolean(user?.avatar_url) && !avatarError;

  const sharingParticipant = participants.find((p) => p.sharing);
  const sharerUserId = sharingParticipant?.user_id ?? screenshare?.sharerUserId ?? null;
  const sharerName = sharingParticipant?.name;
  const someoneElseSharing = Boolean(sharerUserId) && sharerUserId !== user?.id;
  const currentlyViewing = screenshare?.isViewing;

  return (
    <aside class={styles.sidebar} style={style}>
      <div class={`${styles.channel} has-scrollbar`}>
        <div class={styles.channelHeader}>
          <span class={styles.channelIcon}>🔊</span>
          <span class={styles.channelName}>{UI_CONFIG.voiceChannelName}</span>
        </div>

        <ul class={styles.participantList}>
          {participants.map((p) => {
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
        </ul>
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
        >
          {isJoined ? 'Disconnect' : 'Join Voice'}
        </button>
        {isJoined && (
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
      />
    </aside>
  );
}
