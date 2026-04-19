import { memo, useState, useMemo } from 'preact/compat';
import { createPortal } from 'preact/compat';
import snarkdown from 'snarkdown';
import DOMPurify from 'dompurify';
import { TIMESTAMP_RECENT_THRESHOLD_MS, TIMESTAMP_TODAY_THRESHOLD_MS } from '../../constants.js';
import styles from './message.module.css';

function formatTimestamp(ts) {
  const diff = Date.now() - ts;
  if (diff < TIMESTAMP_RECENT_THRESHOLD_MS) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < TIMESTAMP_TODAY_THRESHOLD_MS) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 45%, 48%)`;
}

const sanitizeOptions = { USE_PROFILES: { html: true }, FORBID_TAGS: ['style'], FORBID_ATTR: ['style'] };

function Lightbox({ src, onClose }) {
  return (
    <div class={styles.lightbox} onClick={onClose}>
      <img class={styles.lightboxImg} src={src} alt="preview" onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

function MessageInner({ message, grouped, animate }) {
  const { author, content, image_url, image, created_at, timestamp, pending } = message;
  const name = author?.display_name ?? author?.name ?? 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const html = useMemo(
    () => DOMPurify.sanitize(snarkdown(content || ''), sanitizeOptions),
    [content],
  );
  const [preview, setPreview] = useState(false);

  const ts = created_at ? new Date(created_at).getTime() : (timestamp || Date.now());
  const imgSrc = image_url || image;
  const isVideo = imgSrc && /\.(mp4|webm|mov)(\?|$)/i.test(imgSrc);

  const mediaEl = imgSrc && (
    <div class={styles.mediaWrapper}>
      {isVideo ? (
        <video
          class={`${styles.image}${pending ? ` ${styles.pending}` : ''}`}
          src={imgSrc}
          controls={!pending}
          loop
          muted
          playsinline
          preload="metadata"
        />
      ) : (
        <img
          class={`${styles.image}${pending ? ` ${styles.pending}` : ''}`}
          src={imgSrc}
          alt="attachment"
          loading="lazy"
          decoding="async"
          onClick={() => !pending && setPreview(true)}
        />
      )}
      {pending && <progress class={styles.pendingOverlay} />}
    </div>
  );

  if (grouped) {
    return (
      <div class={styles.grouped}>
        {content && <div class={styles.content} dangerouslySetInnerHTML={{ __html: html }} />}
        {mediaEl}
        {preview && createPortal(<Lightbox src={imgSrc} onClose={() => setPreview(false)} />, document.body)}
      </div>
    );
  }

  return (
    <div class={styles.message}>
      <div class={styles.avatar} style={{ background: author?.avatar_url ? 'transparent' : avatarColor(name) }}>
        {author?.avatar_url
          ? <img class={styles.avatarImg} src={author.avatar_url} alt={name} loading="lazy" decoding="async" />
          : initial}
      </div>
      <div class={styles.body}>
        <div class={animate ? styles.headerAnimated : styles.header}>
          <span class={styles.authorName}>{name}</span>
          <span class={styles.timestamp} title={new Date(ts).toLocaleString()}>{formatTimestamp(ts)}</span>
        </div>
        {content && <div class={styles.content} dangerouslySetInnerHTML={{ __html: html }} />}
        {mediaEl}
      </div>
      {preview && createPortal(<Lightbox src={imgSrc} onClose={() => setPreview(false)} />, document.body)}
    </div>
  );
}

export const Message = memo(MessageInner);
