import { useEffect, useRef } from 'preact/hooks';
import styles from './alert-modal.module.css';

export function AlertModal({ title = 'Microcord', message, onClose }) {
  const okRef = useRef(null);

  useEffect(() => {
    okRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div class={styles.overlay} onClick={onClose}>
      <div
        class="window active"
        style={{ width: 360 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="title-bar">
          <div class="title-bar-text">{title}</div>
          <div class="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div class="window-body has-space">
          <p style={{ margin: '12px 0 18px', fontSize: 13 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button ref={okRef} onClick={onClose} style={{ minWidth: 75 }}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
