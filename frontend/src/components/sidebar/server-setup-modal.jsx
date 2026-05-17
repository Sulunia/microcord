import { useState } from 'preact/hooks';
import styles from './sidebar.module.css';

export function ServerSetupModal({ availableChannels, onRequestDeleteChannel, onCloseModal }) {
  const [activeTab, setActiveTab] = useState('channels');
  const [channelPendingDeletion, setChannelPendingDeletion] = useState(null);
  const [isDeletingChannel, setIsDeletingChannel] = useState(false);

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
                            ✕
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
