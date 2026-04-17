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

function Lightbox({ src, isVideo, onClose }) {
  return (
    <div class={styles.lightbox} onClick={onClose}>
      {isVideo ? (
        <video
          class={styles.lightboxVideo}
          src={src}
          autoplay
          loop
          muted
          playsinline
          controls
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img class={styles.lightboxImg} src={src} alt="preview" onClick={(e) => e.stopPropagation()} />
      )}
    </div>
  );
}

function MediaAttachment({ src, onPreview }) {
  if (src && /\.mp4(\?|$)/i.test(src)) {
    return (
      <video
        class={styles.video}
        src={src}
        autoplay
        loop
        muted
        playsinline
        onClick={() => onPreview(true)}
      />
    );
  }
  return (
    <img
      class={styles.image}
      src={src}
      alt="attachment"
      loading="lazy"
      decoding="async"
      onClick={() => onPreview(false)}
    />
  );
}

function MessageInner({ message, grouped, animate }) {
  const { author, content, image_url, image, created_at, timestamp } = message;
  const name = author?.display_name ?? author?.name ?? 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const html = useMemo(
    () => DOMPurify.sanitize(snarkdown(content || ''), sanitizeOptions),
    [content],
  );
  const [preview, setPreview] = useState(null);

  const ts = created_at ? new Date(created_at).getTime() : (timestamp || Date.now());
  const imgSrc = image_url || image;
  const isVideoPreview = preview === true;

  if (grouped) {
    return (
      <div class={styles.grouped}>
        {content && <div class={styles.content} dangerouslySetInnerHTML={{ __html: html }} />}
        {imgSrc && <MediaAttachment src={imgSrc} onPreview={setPreview} />}
        {preview !== null && createPortal(<Lightbox src={imgSrc} isVideo={isVideoPreview} onClose={() => setPreview(null)} />, document.body)}
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
        {imgSrc && <MediaAttachment src={imgSrc} onPreview={setPreview} />}
      </div>
      {preview !== null && createPortal(<Lightbox src={imgSrc} isVideo={isVideoPreview} onClose={() => setPreview(null)} />, document.body)}
    </div>
  );
}

export const Message = memo(MessageInner);
