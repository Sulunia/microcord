import { useEffect, useState, useRef } from 'preact/hooks';
import { UI_CONFIG } from '../../constants.js';
import styles from './sidebar.module.css';
import { UserProfileModal } from './user-profile-modal.jsx';

function IconMicOn() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
    );
}

function IconMicOff() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
            <path d="M5 10v2a7 7 0 0 0 12 5" />
            <path d="M9 4.73A3 3 0 0 1 15 5v6.27" />
            <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
    );
}

function IconHeadphonesOn() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
            <path d="M3 18v-1a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2z" />
            <path d="M17 18v-1a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h0a2 2 0 0 1-2-2z" />
        </svg>
    );
}

function IconHeadphonesOff() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="2" y1="2" x2="22" y2="22" />
            <path d="M3 14v-3a9 9 0 0 1 15.4-6.4" />
            <path d="M21 14v1.5" />
            <path d="M21 14a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v.5" />
            <path d="M3 14a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M15.5 19.5a2 2 0 0 1-2-2v-1" />
        </svg>
    );
}

function Participant({ name, avatarUrl, isSpeaking, isSharer, isMuted, isDeafened, canWatch, onWatch, isNew }) {
    const initial = name.charAt(0).toUpperCase();
    return (
        <li class={`${styles.participant} ${isSpeaking && !isMuted ? styles.speaking : ''} ${isNew ? styles.participantNew : ''}`}>
            <span class={styles.participantAvatar}>
                {avatarUrl
                    ? <img src={avatarUrl} alt={name} class={styles.participantAvatarImg} />
                    : initial}
            </span>
            <span class={styles.participantName}>
                {name}
                {isSharer && <span class={styles.sharingBadge}>sharing</span>}
            </span>
            {isDeafened && (
                <span class={styles.statusIcon} title="Deafened"><IconHeadphonesOff /></span>
            )}
            {!isDeafened && isMuted && (
                <span class={styles.statusIcon} title="Muted"><IconMicOff /></span>
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
    const { participants, isJoined, isMuted, isDeafened, isSpeaking, speakingUsers, join, leave, toggleMute, toggleDeafen } = voice;
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
            const participantDeafened = Boolean(p.deafened);
            return (
              <Participant
                key={pid}
                name={p.name}
                avatarUrl={p.avatar_url}
                isSpeaking={speakingUsers.get(pid) ?? Boolean(p.speaking)}
                isSharer={isSharer}
                isMuted={participantMuted}
                isDeafened={participantDeafened}
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
        </div>
        {isJoined && (
          <div class={styles.controlRow}>
            <button
              class={`${styles.controlBtn} ${isMuted ? styles.controlBtnActive : ''}`}
              onClick={toggleMute}
              title={isDeafened ? 'Undeafen' : isMuted ? 'Unmute' : 'Mute'}
            >
              {isDeafened ? <IconMicOff /> : isMuted ? <IconMicOff /> : <IconMicOn />}
            </button>
            <button
              class={`${styles.controlBtn} ${isDeafened ? styles.controlBtnActive : ''}`}
              onClick={toggleDeafen}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <IconHeadphonesOff /> : <IconHeadphonesOn />}
            </button>
          </div>
        )}
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
        <button
          class={`${styles.voiceBtn} ${isJoined ? styles.voiceBtnLeave : ''}`}
          onClick={isJoined ? leave : join}
        >
          {isJoined ? 'Disconnect' : 'Join Voice'}
        </button>
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
