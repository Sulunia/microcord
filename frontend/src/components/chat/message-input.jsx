import { useState, useRef } from 'preact/hooks';
import styles from './message-input.module.css';
import { AlertModal } from '../alert-modal.jsx';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

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
        if (file.size > MAX_IMAGE_BYTES) {
          setAlertMsg('Attachment is too big to be sent (max 50 MB).');
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
    await onSend(text, imageFile);
    setText('');
    clearImage();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setAlertMsg('Attachment is too big to be sent (max 50 MB).');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div class={styles.inputArea}>
      {imagePreview && (
        <div class={styles.preview}>
          <img src={imagePreview} alt="preview" class={styles.previewImg} />
          <div class={styles.previewRemove} onClick={clearImage}>✕</div>
        </div>
      )}
      <div class={styles.row}>
        <button
          class={styles.attachBtn}
          onClick={() => fileRef.current?.click()}
          title="Attach media"
        >
          📎
        </button>
        <input
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
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
