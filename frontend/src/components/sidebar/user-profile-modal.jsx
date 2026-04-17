import { useEffect, useState, useRef } from 'preact/hooks';
import styles from './sidebar.module.css';
import { TICK_SOUNDS } from '../../constants.js';
import { AlertModal } from '../alert-modal.jsx';

const AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/avif';

export function UserProfileModal({ isOpen, user, onClose, onSave, onUploadAvatar, onLogout }) {
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarError, setAvatarError] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] });
  const [selectedInput, setSelectedInput] = useState(() => localStorage.getItem('mc-audio-input') || '');
  const [selectedOutput, setSelectedOutput] = useState(() => localStorage.getItem('mc-audio-output') || '');
  const [selectedTick, setSelectedTick] = useState(1);
  const fileRef = useRef(null);
  const tickAudioRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(user?.display_name ?? user?.name ?? '');
    setAvatarPreview(null);
    setAvatarFile(null);
    setAvatarError(null);
    setSelectedTick(user?.tick_sound ?? 1);
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setAudioDevices({
        inputs: devices.filter((d) => d.kind === 'audioinput'),
        outputs: devices.filter((d) => d.kind === 'audiooutput'),
      });
    }).catch(() => {});
  }, [isOpen, user]);

  const handleAvatarPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);

    if (file.size > AVATAR_MAX_BYTES) {
      setAlertMsg('Avatar file is too large (max 1 MB).');
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const doUploadAvatar = async () => {
    if (!avatarFile || !onUploadAvatar) return;
    setIsUploading(true);
    setAvatarError(null);
    const ok = await onUploadAvatar(avatarFile);
    setIsUploading(false);
    if (!ok) {
      setAvatarError('Upload failed');
      return;
    }
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const save = async (e) => {
    e.preventDefault();
    if (isSaving) return;

    const trimmed = displayName.trim();
    if (!trimmed) return;

    setIsSaving(true);

    if (avatarFile) {
      await doUploadAvatar();
    }

    const ok = await onSave({ display_name: trimmed, tick_sound: selectedTick });
    if (!ok) {
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    onClose();
  };

  if (!isOpen) return null;

  const initials = (displayName || user?.display_name || user?.name || '?').trim().charAt(0).toUpperCase();
  const previewSrc = avatarPreview || user?.avatar_url;

  return (
    <div class={styles.profileModalBackdrop} onClick={onClose}>
      <div class="window active" style={{ width: 'min(400px, calc(100% - 32px))' }} onClick={(e) => e.stopPropagation()}>
        <div class="title-bar">
          <div class="title-bar-text">Profile</div>
          <div class="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div class="window-body has-space">
          <form class={styles.profileModal} onSubmit={save}>
            <p class={styles.profileModalSubtitle}>
              Logged in as <strong>{user?.name}</strong>
            </p>
            <div
              class={styles.profileAvatarPreview}
              onClick={() => fileRef.current?.click()}
              title="Click to change avatar"
            >
              {previewSrc ? (
                <img src={previewSrc} class={styles.profileAvatarImage} alt="Avatar preview" />
              ) : (
                <span class={styles.profileAvatarFallback}>{initials}</span>
              )}
              <span class={styles.profileAvatarOverlay}>Change</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={AVATAR_ACCEPT}
              style={{ display: 'none' }}
              onChange={handleAvatarPick}
            />
            {avatarError && <p class={styles.profileAvatarError}>{avatarError}</p>}
            {avatarFile && !avatarError && (
              <button
                type="button"
                onClick={doUploadAvatar}
                disabled={isUploading}
                style={{ alignSelf: 'center' }}
              >
                {isUploading ? 'Uploading…' : 'Upload Avatar'}
              </button>
            )}
            <div class={styles.profileFieldGroup}>
              <label for="profile-name">Display Name</label>
              <input
                id="profile-name"
                value={displayName}
                maxLength={40}
                onInput={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                required
              />
            </div>
            <div class={styles.profileDeviceGroup}>
              <label for="audio-input">Microphone</label>
              <select
                id="audio-input"
                value={selectedInput}
                onChange={(e) => {
                  setSelectedInput(e.target.value);
                  localStorage.setItem('mc-audio-input', e.target.value);
                }}
              >
                <option value="">Default</option>
                {audioDevices.inputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                  </option>
                ))}
              </select>
            </div>
            <div class={styles.profileDeviceGroup}>
              <label for="audio-output">Speaker</label>
              <select
                id="audio-output"
                value={selectedOutput}
                onChange={(e) => {
                  setSelectedOutput(e.target.value);
                  localStorage.setItem('mc-audio-output', e.target.value);
                }}
              >
                <option value="">Default</option>
                {audioDevices.outputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Speaker (${d.deviceId.slice(0, 8)})`}
                  </option>
                ))}
              </select>
            </div>
            <div class={styles.profileTickGroup}>
              <label>Message Tick Sound</label>
              <div class={styles.profileTickOptions}>
                {TICK_SOUNDS.map((t) => (
                  <div key={t.id} class={styles.profileTickOption}>
                    <input
                      type="radio"
                      id={`tick-${t.id}`}
                      name="tick_sound"
                      value={t.id}
                      checked={selectedTick === t.id}
                      onChange={() => {
                        setSelectedTick(t.id);
                        if (tickAudioRef.current) {
                          tickAudioRef.current.pause();
                          tickAudioRef.current.currentTime = 0;
                        }
                        const a = new Audio(t.url);
                        tickAudioRef.current = a;
                        a.play().catch(() => {});
                      }}
                    />
                    <label for={`tick-${t.id}`}>{t.label}</label>
                  </div>
                ))}
              </div>
            </div>
            <div class={styles.profileModalActions}>
              {onLogout && (
                <button
                  type="button"
                  class={styles.profileLogoutButton}
                  onClick={onLogout}
                >
                  Log out
                </button>
              )}
              <span class={styles.profileActionSpacer} />
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button type="submit" disabled={isSaving || !displayName.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
      {alertMsg && <AlertModal message={alertMsg} onClose={() => setAlertMsg(null)} />}
    </div>
  );
}
