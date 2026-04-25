import { useEffect, useState, useRef } from 'preact/hooks';
import styles from './sidebar.module.css';
import { TICK_SOUNDS, APP_VERSION } from '../../constants.js';
import { AlertModal } from '../alert-modal.jsx';
import { useTheme } from '../../hooks/use-theme.js';
import { computeVadThreshold } from '../../hooks/use-voice.js';

const AVATAR_MAX_BYTES = 1 * 1024 * 1024;
const AVATAR_ACCEPT = 'image/jpeg,image/png,image/avif';

export function UserProfileModal({ isOpen, user, isSpeaking, onClose, onSave, onUploadAvatar, onLogout }) {
  const [displayName, setDisplayName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [avatarConverting, setAvatarConverting] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarError, setAvatarError] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] });
  const [selectedInput, setSelectedInput] = useState(() => localStorage.getItem('mc-audio-input') || '');
  const [selectedOutput, setSelectedOutput] = useState(() => localStorage.getItem('mc-audio-output') || '');
  const [selectedTick, setSelectedTick] = useState(1);
  const [vadSensitivity, setVadSensitivity] = useState(() => parseInt(localStorage.getItem('mc-vad-sensitivity'), 10) || 50);
  const { theme, setTheme } = useTheme();
  const fileRef = useRef(null);
  const tickAudioRef = useRef(null);
  const [micDetected, setMicDetected] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let audioCtx = null;
    let analyser = null;
    let stream = null;
    let rafId = null;
    let speaking = false;
    let lastChange = 0;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch { return; }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const data = new Uint8Array(analyser.fftSize);

      const tick = () => {
        if (cancelled) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const sensitivity = parseInt(localStorage.getItem('mc-vad-sensitivity'), 10) || 50;
        const threshold = computeVadThreshold(sensitivity);
        const now = performance.now();
        const loud = rms > threshold;
        if (loud !== speaking) {
          if (now - lastChange >= 90) {
            speaking = loud;
            lastChange = now;
            setMicDetected(speaking);
          }
        } else {
          lastChange = now;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    };

    start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (stream) stream.getTracks().forEach(t => t.stop());
      setMicDetected(false);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(user?.display_name ?? user?.name ?? '');
    setAvatarPreview(null);
    setAvatarFile(null);
    setAvatarError(null);
    setAvatarConverting(false);
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
    setAvatarConverting(true);
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
              onClick={() => !avatarConverting && fileRef.current?.click()}
              title={avatarConverting ? 'Converting…' : 'Click to change avatar'}
            >
              {previewSrc ? (
                <img src={previewSrc} class={styles.profileAvatarImage} alt="Avatar preview" />
              ) : (
                <span class={styles.profileAvatarFallback}>{initials}</span>
              )}
              {avatarConverting && <progress class={styles.avatarProgress} />}
              {!avatarConverting && <span class={styles.profileAvatarOverlay}>Change</span>}
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
            <div class={styles.profileDeviceRow}>
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
            </div>
            <div class={styles.profileVadGroup}>
              <label for="vad-sensitivity">Voice Activation Sensitivity: {vadSensitivity} {micDetected ? '🟢' : '🔴'}</label>
              <input
                id="vad-sensitivity"
                type="range"
                min="1"
                max="100"
                step="1"
                value={vadSensitivity}
                onInput={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setVadSensitivity(val);
                  localStorage.setItem('mc-vad-sensitivity', String(val));
                }}
              />
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
            <div class={styles.profileFieldGroup}>
              <label for="theme-select">Theme</label>
              <select
                id="theme-select"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
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
            <p class={styles.profileVersion}>Microcord {APP_VERSION}</p>
          </form>
        </div>
      </div>
      {alertMsg && <AlertModal message={alertMsg} onClose={() => setAlertMsg(null)} />}
    </div>
  );
}
