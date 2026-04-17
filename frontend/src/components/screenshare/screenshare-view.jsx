import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import styles from './screenshare-view.module.css';

export function ScreenshareView({ stream, sharerName, isLocal, onDisconnect }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    return () => { el.srcObject = null; };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  if (!stream) {
    return (
      <div class={styles.container}>
        <div class={styles.loading}>
          <span class={styles.hourglass}>⏳</span>
          <span class={styles.loadingText}>
            {isLocal ? 'Starting share…' : `${sharerName || 'Someone'} is sharing — connecting…`}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div class={styles.container} ref={containerRef}>
      <video
        ref={videoRef}
        class={styles.video}
        autoPlay
        playsInline
        muted={isLocal}
      />
      <div class={styles.toolbar}>
        <span class={styles.sharerLabel}>
          {isLocal ? 'You are sharing' : `${sharerName || 'Someone'} is sharing`}
        </span>
        {!isLocal && (
          <input
            type="range"
            class={styles.volumeSlider}
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onInput={(e) => setVolume(parseFloat(e.target.value))}
            title={`Volume: ${Math.round(volume * 100)}%`}
          />
        )}
        <button
          class={styles.toolbarBtn}
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? '⊡' : '⛶'}
        </button>
        <button
          class={styles.disconnectBtn}
          onClick={onDisconnect}
          title={isLocal ? 'Stop sharing' : 'Stop viewing'}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
