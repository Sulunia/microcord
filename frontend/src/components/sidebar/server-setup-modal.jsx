import { useState } from 'preact/hooks';
import { authedFetch } from '../../hooks/use-user.js';
import { API_BASE } from '../../constants.js';
import { ServerConfigView } from '../server-config-view.jsx';
import styles from './sidebar.module.css';

export function ServerSetupModal({ availableChannels, onRequestDeleteChannel, onCloseModal, currentUser, users, voiceChannels, onCreateVoiceChannel, onDeleteVoiceChannel }) {
  const isOwner = currentUser?.is_owner === true;
  const [activeTab, setActiveTab] = useState(isOwner ? 'channels' : 'channels');
  const [channelPendingDeletion, setChannelPendingDeletion] = useState(null);
  const [isDeletingChannel, setIsDeletingChannel] = useState(false);
  const [pendingRecoveryUser, setPendingRecoveryUser] = useState(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState(null);
  const [recoveryExpiresAt, setRecoveryExpiresAt] = useState(null);
  const [recoveryError, setRecoveryError] = useState(null);
  const [usersList, setUsersList] = useState(users || []);
  const [newVoiceChannelName, setNewVoiceChannelName] = useState('');
  const [isCreatingVoiceChannel, setIsCreatingVoiceChannel] = useState(false);
  const [pendingDeleteVoiceChannel, setPendingDeleteVoiceChannel] = useState(null);
  const [isDeletingVoiceChannel, setIsDeletingVoiceChannel] = useState(false);

  const handleDeleteClick = (channelId) => {
    setChannelPendingDeletion(channelId);
  };

  const handleConfirmDelete = async () => {
    if (isDeletingChannel || !channelPendingDeletion) return;
    setIsDeletingChannel(true);
    await onRequestDeleteChannel(channelPendingDeletion);
    setIsDeletingChannel(false);
    setChannelPendingDeletion(null);
  };

  const handleCancelDelete = () => {
    setChannelPendingDeletion(null);
  };

  const handleRecoverClick = (user) => {
    setPendingRecoveryUser(user);
    setRecoveryError(null);
  };

  const handleConfirmRecover = async () => {
    if (isRecovering || !pendingRecoveryUser) return;
    setIsRecovering(true);
    setRecoveryError(null);
    try {
      const res = await authedFetch(`${API_BASE}/users/${pendingRecoveryUser.id}/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setRecoveryError(body.error || 'Recovery failed');
        setIsRecovering(false);
        return;
      }
      const data = await res.json();
      setRecoveryPassphrase(data.recovery_passphrase);
      setRecoveryExpiresAt(data.expires_at);
      setPendingRecoveryUser(null);
      setUsersList((prev) =>
        prev.map((u) =>
          u.id === pendingRecoveryUser.id
            ? { ...u, recovery_status: 'pending' }
            : u
        )
      );
    } catch {
      setRecoveryError('Network error');
    }
    setIsRecovering(false);
  };

  const handleCancelRecover = () => {
    setPendingRecoveryUser(null);
    setRecoveryError(null);
  };

  const handleDismissPassphrase = () => {
    setRecoveryPassphrase(null);
    setRecoveryExpiresAt(null);
  };

  const handleCopyPassphrase = async () => {
    if (recoveryPassphrase) {
      try {
        await navigator.clipboard.writeText(recoveryPassphrase);
      } catch {}
    }
  };

  const recoveryStatusText = (user) => {
    if (!user.recovery_status) return null;
    if (user.recovery_status === 'pending') return { text: 'Recovery pending', className: styles.recoveryStatusPending };
    return null;
  };

  const handleCreateVoiceChannel = async (e) => {
    e.preventDefault();
    if (isCreatingVoiceChannel || !newVoiceChannelName.trim()) return;
    setIsCreatingVoiceChannel(true);
    try {
      await onCreateVoiceChannel(newVoiceChannelName.trim());
      setNewVoiceChannelName('');
    } catch (err) {
      console.error('Failed to create voice channel:', err.message);
    }
    setIsCreatingVoiceChannel(false);
  };

  const confirmDeleteVoiceChannel = async () => {
    if (isDeletingVoiceChannel || !pendingDeleteVoiceChannel) return;
    setIsDeletingVoiceChannel(true);
    try {
      await onDeleteVoiceChannel(pendingDeleteVoiceChannel);
    } catch (err) {
      console.error('Failed to delete voice channel:', err.message);
    }
    setIsDeletingVoiceChannel(false);
    setPendingDeleteVoiceChannel(null);
  };

  const cancelDeleteVoiceChannel = () => {
    setPendingDeleteVoiceChannel(null);
  };

  return (
    <div class={styles.profileModalBackdrop} onClick={onCloseModal}>
      <div class="window active" style={{ width: 'min(440px, calc(100% - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <div class="title-bar">
          <div class="title-bar-text">Server Setup</div>
          <div class="title-bar-controls">
            <button aria-label="Close" onClick={onCloseModal} />
          </div>
        </div>
        <div class="window-body has-space">
          <div class={styles.setupTablist}>
            <button
              class={`${styles.setupTab} ${activeTab === 'channels' ? styles.setupTabActive : ''}`}
              onClick={() => setActiveTab('channels')}
            >
              Channel Management
            </button>
            <button
              class={`${styles.setupTab} ${activeTab === 'voice' ? styles.setupTabActive : ''}`}
              onClick={() => setActiveTab('voice')}
            >
              Voice Channels
            </button>
            {isOwner && (
              <button
                class={`${styles.setupTab} ${activeTab === 'recovery' ? styles.setupTabActive : ''}`}
                onClick={() => setActiveTab('recovery')}
              >
                Account Recovery
              </button>
            )}
            <button
              class={`${styles.setupTab} ${activeTab === 'config' ? styles.setupTabActive : ''}`}
              onClick={() => setActiveTab('config')}
            >
              Server Config
            </button>
          </div>
          {activeTab === 'channels' && (
            <div class={styles.channelList}>
              {availableChannels.length === 0 && (
                <p style={{ color: 'var(--mc-text-muted)', fontSize: '0.82rem', margin: 0 }}>No channels found.</p>
              )}
              {availableChannels.map((channel) => {
                const isDefaultChannel = channel.is_default === true;
                const isProtectedChannel = isDefaultChannel;
                const isPendingDelete = channelPendingDeletion === channel.id;

                return (
                  <div key={channel.id} class={styles.channelRow}>
                    {isPendingDelete ? (
                      <div class={styles.channelDeleteConfirm}>
                        <span>Delete #{channel.name} and all messages?</span>
                        <div class={styles.channelDeleteConfirmActions}>
                          <button
                            class={styles.channelDeleteDanger}
                            onClick={handleConfirmDelete}
                            disabled={isDeletingChannel}
                          >
                            {isDeletingChannel ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button onClick={handleCancelDelete} disabled={isDeletingChannel}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span class={styles.channelRowName}># {channel.name}</span>
                        {!isProtectedChannel && (
                          <button
                            class={styles.channelDeleteBtn}
                            onClick={() => handleDeleteClick(channel.id)}
                            title={`Delete #${channel.name}`}
                          >
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === 'voice' && (
            <div class={styles.channelList}>
              {currentUser?.is_admin && (
                <form onSubmit={handleCreateVoiceChannel} style={{ marginBottom: '8px', display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    maxLength="24"
                    placeholder="Voice channel name..."
                    value={newVoiceChannelName}
                    onInput={(e) => setNewVoiceChannelName(e.target.value)}
                    style={{ flex: 1 }}
                    disabled={isCreatingVoiceChannel}
                  />
                  <button type="submit" disabled={!newVoiceChannelName.trim() || isCreatingVoiceChannel}>
                    {isCreatingVoiceChannel ? 'Creating…' : 'Create'}
                  </button>
                </form>
              )}
              {(voiceChannels || []).map((vc) => {
                const canDelete = (voiceChannels || []).length > 1 && (vc.participant_count || 0) === 0;
                const isPendingDelete = pendingDeleteVoiceChannel === vc.id;
                return (
                  <div key={vc.id} class={styles.channelRow}>
                    {isPendingDelete ? (
                      <div class={styles.channelDeleteConfirm}>
                        <span>Delete voice channel "{vc.name}"?</span>
                        <div class={styles.channelDeleteConfirmActions}>
                          <button class={styles.channelDeleteDanger} onClick={confirmDeleteVoiceChannel} disabled={isDeletingVoiceChannel}>
                            {isDeletingVoiceChannel ? 'Deleting…' : 'Confirm'}
                          </button>
                          <button onClick={cancelDeleteVoiceChannel} disabled={isDeletingVoiceChannel}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span class={styles.channelRowName}>🔊 {vc.name} ({vc.participant_count || 0})</span>
                        {currentUser?.is_admin && canDelete && (
                          <button class={styles.channelDeleteBtn} onClick={() => setPendingDeleteVoiceChannel(vc.id)} title={`Delete ${vc.name}`}>
                            🗑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {(voiceChannels || []).length === 0 && (
                <p style={{ color: 'var(--mc-text-muted)', fontSize: '0.82rem', margin: 0 }}>No voice channels found.</p>
              )}
            </div>
          )}
          {activeTab === 'recovery' && isOwner && (
            <div class={styles.recoverySection}>
              {recoveryPassphrase ? (
                <div class={styles.recoveryPassphraseDisplay}>
                  <p class={styles.recoveryWarning}>Recovery passphrase (shown only once):</p>
                  <div class={styles.recoveryPassphraseBox}>
                    <code class={styles.recoveryPassphraseCode}>{recoveryPassphrase}</code>
                    <button class={styles.recoveryCopyBtn} onClick={handleCopyPassphrase} title="Copy to clipboard">
                      📋
                    </button>
                  </div>
                  {recoveryExpiresAt && (
                    <p class={styles.recoveryExpiry}>Expires: {new Date(recoveryExpiresAt).toLocaleString()}</p>
                  )}
                  {!recoveryExpiresAt && (
                    <p class={styles.recoveryExpiry}>This passphrase does not expire.</p>
                  )}
                  <button onClick={handleDismissPassphrase} style={{ marginTop: '8px' }}>
                    Dismiss
                  </button>
                </div>
              ) : (
                <>
                  {recoveryError && (
                    <p class={styles.recoveryError}>{recoveryError}</p>
                  )}
                  <div class={styles.recoveryUserList}>
                    {usersList.map((u) => {
                      const status = recoveryStatusText(u);
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <div key={u.id} class={styles.recoveryUserRow}>
                          <span class={styles.recoveryUserAvatar}>
                            {u.avatar_url
                              ? <img src={u.avatar_url} alt={u.display_name} class={styles.recoveryUserAvatarImg} />
                              : (u.display_name || '?').charAt(0).toUpperCase()}
                          </span>
                          <span class={styles.recoveryUserName}>
                            {u.display_name}
                            {isSelf && <span class={styles.recoverySelfBadge}>(you)</span>}
                            {u.is_owner && <span class={styles.recoveryRoleBadge}>👑</span>}
                            {!u.is_owner && u.is_admin && <span class={styles.recoveryRoleBadge}>⭐</span>}
                          </span>
                          {status && (
                            <span class={status.className}>{status.text}</span>
                          )}
                          {pendingRecoveryUser?.id === u.id ? (
                            <div class={styles.recoveryConfirmActions}>
                              <button
                                class={styles.channelDeleteDanger}
                                onClick={handleConfirmRecover}
                                disabled={isRecovering}
                              >
                                {isRecovering ? 'Generating…' : 'Confirm'}
                              </button>
                              <button onClick={handleCancelRecover} disabled={isRecovering}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              class={styles.recoverBtn}
                              onClick={() => handleRecoverClick(u)}
                              title={`Recover ${u.display_name}'s account`}
                            >
                              Recover
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          {activeTab === 'config' && (
            <div style={{ overflow: 'auto', maxHeight: 'calc(80vh - 140px)' }}>
              <ServerConfigView />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
