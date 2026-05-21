import { useState, useEffect } from 'preact/hooks';
import { LIVE_MEDIA_CONFIG, initLiveMediaConfig } from '../constants.js';
import appStyles from '../app.module.css';

export function ServerConfigView() {
  const [serverConfig, setServerConfig] = useState(null);

  useEffect(() => {
    initLiveMediaConfig().then(() => {
      setServerConfig({
        iceServers: LIVE_MEDIA_CONFIG.iceServers,
        audio: LIVE_MEDIA_CONFIG.audio,
        screenshare: LIVE_MEDIA_CONFIG.screenshare,
        media: LIVE_MEDIA_CONFIG.media,
      });
    });
  }, []);

  if (!serverConfig) {
    return <p style={{ color: 'var(--mc-text-muted)', fontSize: '0.85rem' }}>Loading server config…</p>;
  }

  return (
    <div class={appStyles.configSection}>
      <h4 class={appStyles.configHeading}>ICE Servers</h4>
      <pre class={appStyles.configPre}>{JSON.stringify(serverConfig.iceServers, null, 2)}</pre>

      <h4 class={appStyles.configHeading}>Audio</h4>
      <table class={appStyles.cheatsheet}>
        <tbody>
          <tr><td>Echo Cancellation</td><td>{String(serverConfig.audio.echo_cancellation)}</td></tr>
          <tr><td>Noise Suppression</td><td>{String(serverConfig.audio.noise_suppression)}</td></tr>
          <tr><td>Auto Gain Control</td><td>{String(serverConfig.audio.auto_gain_control)}</td></tr>
          <tr><td>Opus Bitrate</td><td>{serverConfig.audio.opus_bitrate} bps</td></tr>
          <tr><td>Opus Stereo</td><td>{String(serverConfig.audio.opus_stereo)}</td></tr>
        </tbody>
      </table>

      <h4 class={appStyles.configHeading}>Screenshare</h4>
      <table class={appStyles.cheatsheet}>
        <tbody>
          <tr><td>Resolution</td><td>{serverConfig.screenshare.width}×{serverConfig.screenshare.height}</td></tr>
          <tr><td>Frame Rate</td><td>{serverConfig.screenshare.frameRate} fps</td></tr>
        </tbody>
      </table>

      <h4 class={appStyles.configHeading}>Media Processing</h4>
      <table class={appStyles.cheatsheet}>
        <tbody>
          <tr><td>AVIF CRF</td><td>{serverConfig.media.avif_crf}</td></tr>
          <tr><td>AV1 CRF</td><td>{serverConfig.media.av1_crf}</td></tr>
          <tr><td>Video Scale</td><td>{serverConfig.media.video_scale}</td></tr>
          <tr><td>Video Max Bitrate</td><td>{serverConfig.media.video_max_bitrate || 'unlimited'}</td></tr>
          <tr><td>FFmpeg Threads</td><td>{serverConfig.media.ffmpeg_threads}</td></tr>
          <tr><td>Image Max Dimension</td><td>{serverConfig.media.image_max_dimension}px</td></tr>
        </tbody>
      </table>
    </div>
  );
}
