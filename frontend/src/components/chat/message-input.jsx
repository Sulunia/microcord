import { useState, useRef } from 'preact/hooks';
import styles from './message-input.module.css';
import { AlertModal } from '../alert-modal.jsx';
import { MEDIA_TRANSCODE } from '../../constants.js';

const MAX_MESSAGE_LENGTH = 4000;

function getMaxBytes(file) {
  const cfg = MEDIA_TRANSCODE;
  if (!cfg.enabled) return cfg.maxOutputBytes;
  const isVideo = file.type === 'image/gif' || file.type.startsWith('video/');
  return isVideo ? cfg.maxVideoInputBytes : cfg.maxImageInputBytes;
}

function sizeLabel(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function MessageInput({ onSend }) {
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);
  const fileRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const max = getMaxBytes(file);
        if (file.size > max) {
          setAlertMsg(`Image is too large (max ${sizeLabel(max)}).`);
          return;
        }
        setImageFile(file);
        const reader = new FileReader();
        reader.onload = () => setImagePreview(reader.result);
        reader.readAsDataURL(file);
        return;
      }
    }
  };

  const submit = async () => {
    if (!text.trim() && !imageFile) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setAlertMsg(`Chat message is too large (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters).`);
      return;
    }
    try {
      await onSend(text, imageFile);
      setText('');
      clearImage();
    } catch (e) {
      if (e.name === 'TranscodeError') {
        setAlertMsg(e.message);
      }
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const max = getMaxBytes(file);
    if (file.size > max) {
      const isVideo = file.type === 'image/gif' || file.type.startsWith('video/');
      setAlertMsg(`${isVideo ? 'Video/GIF' : 'Image'} is too large (max ${sizeLabel(max)}).`);
      return;
    }
    setImageFile(file);
    if (file.type.startsWith('video/')) {
      setImagePreview(null);
    } else {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div class={styles.inputArea}>
      {(imagePreview || imageFile) && (
        <div class={styles.preview}>
          {imagePreview ? (
            <img src={imagePreview} alt="preview" class={styles.previewImg} />
          ) : (
            <span class={styles.previewLabel}>{imageFile?.name}</span>
          )}
          <div class={styles.previewRemove} onClick={clearImage}>✕</div>
        </div>
      )}
      <div class={styles.row}>
        <button
          class={styles.attachBtn}
          onClick={() => fileRef.current?.click()}
          title="Attach image or video"
        >
          📎
        </button>
        <input
          type="file"
          accept="image/*,video/mp4"
          ref={fileRef}
          class={styles.fileInput}
          onChange={handleFileChange}
        />
        <textarea
          class={styles.textarea}
          rows={1}
          placeholder="Message #general"
          value={text}
          onInput={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
        />
        <button class={styles.sendBtn} onClick={submit} title="Send">
          ➤
        </button>
      </div>
      {alertMsg && <AlertModal message={alertMsg} onClose={() => setAlertMsg(null)} />}
    </div>
  );
}
