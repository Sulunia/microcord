import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import styles from './message-input.module.css';
import { AlertModal } from '../alert-modal.jsx';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export function MessageInput({ onSend }) {
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [alertMsg, setAlertMsg] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);
  const textareaRef = useRef(null);
  const dragCounterRef = useRef(0);

  const processFile = useCallback((file) => {
    if (file.size > MAX_IMAGE_BYTES) {
      setAlertMsg('Attachment is too big to be sent (max 50 MB).');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const isExternalFileDrop = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return false;
      if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/html')) return false;
      return true;
    };
    const onDragEnter = (e) => {
      if (!isExternalFileDrop(e)) return;
      e.preventDefault();
      dragCounterRef.current++;
      setIsDragging(true);
    };
    const onDragOver = (e) => {
      if (!isExternalFileDrop(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDragging(false);
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDragging(false);
      if (!isExternalFileDrop(e)) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) processFile(file);
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);

    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [processFile]);

  const handleKeyDown = (e) => {
    if (sending) return;
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
        processFile(file);
        return;
      }
    }
  };

  const submit = async () => {
    if (sending || (!text.trim() && !imageFile)) return;
    if (text.length > MAX_MESSAGE_LENGTH) {
      setAlertMsg(`Chat message is too large (max ${MAX_MESSAGE_LENGTH.toLocaleString()} characters).`);
      return;
    }
    setSending(true);
    try {
      await onSend(text, imageFile);
      setText('');
      clearImage();
    } catch {
      setAlertMsg('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div class={styles.inputArea}>
      {isDragging && (
        <div class={styles.dropOverlay}>
          <div class={styles.dropOverlayInner}>
            <span class={styles.dropIcon}>📎</span>
            <span>Drop file to attach</span>
          </div>
        </div>
      )}
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
          type="button"
          disabled={sending}
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
          ref={textareaRef}
          class={styles.textarea}
          rows={1}
          placeholder="Message #general"
          value={text}
          onInput={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={sending}
        />
        <button class={styles.sendBtn} onClick={submit} title="Send" type="button" disabled={sending}>
          {sending ? <span class={styles.spinner} /> : '➤'}
        </button>
      </div>
      {alertMsg && <AlertModal message={alertMsg} onClose={() => setAlertMsg(null)} />}
    </div>
  );
}
