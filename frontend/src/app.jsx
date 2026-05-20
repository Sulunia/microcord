import { useState, useCallback, useRef, useEffect } from 'preact/hooks';
import { Sidebar } from './components/sidebar/sidebar.jsx';
import { ChatPanel } from './components/chat/chat-panel.jsx';
import { MembersSidebar } from './components/chat/members-sidebar.jsx';
import { LoginScreen } from './components/login-screen.jsx';
import { MobileLayout } from './components/mobile/mobile-layout.jsx';
import { useUser } from './hooks/use-user.js';
import { useChat } from './hooks/use-chat.js';
import { useChannels } from './hooks/use-channels.js';
import { useVoice } from './hooks/use-voice.js';
import { useScreenshare } from './hooks/use-screenshare.js';
import { useIsMobile } from './hooks/use-is-mobile.js';
import { RealtimeProvider } from './hooks/realtime.jsx';
import { UI_CONFIG, LIVE_MEDIA_CONFIG, initLiveMediaConfig, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from './constants.js';
import styles from './app.module.css';

const standaloneQuery = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)');
const isPwa = standaloneQuery.matches || window.navigator.standalone === true;

function HelpModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('markdown');
  const [serverConfig, setServerConfig] = useState(null);

  useEffect(() => {
    if (activeTab === 'server') {
      initLiveMediaConfig().then(() => {
        setServerConfig({
          iceServers: LIVE_MEDIA_CONFIG.iceServers,
          audio: LIVE_MEDIA_CONFIG.audio,
          screenshare: LIVE_MEDIA_CONFIG.screenshare,
          media: LIVE_MEDIA_CONFIG.media,
        });
      });
    }
  }, [activeTab]);

  return (
    <div class={styles.overlay} onClick={onClose}>
      <div class="window glass active" style={{ width: 460, maxHeight: '80vh', '--w7-w-bg': 'var(--mc-window-glass)' }} onClick={(e) => e.stopPropagation()}>
        <div class="title-bar">
          <div class="title-bar-text">Help</div>
          <div class="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div class="window-body has-space">
          <div class={styles.helpTablist}>
            <button
              class={`${styles.helpTab} ${activeTab === 'markdown' ? styles.helpTabActive : ''}`}
              onClick={() => setActiveTab('markdown')}
            >
              Markdown
            </button>
            <button
              class={`${styles.helpTab} ${activeTab === 'server' ? styles.helpTabActive : ''}`}
              onClick={() => setActiveTab('server')}
            >
              Server Config
            </button>
          </div>
          <div style={{ overflow: 'auto', maxHeight: 'calc(80vh - 90px)' }}>
            {activeTab === 'markdown' && (
              <table class={styles.cheatsheet}>
                <thead>
                  <tr><th>Type this</th><th>To get</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>**bold**</code></td><td><strong>bold</strong></td></tr>
                  <tr><td><code>_italic_</code></td><td><em>italic</em></td></tr>
                  <tr><td><code>~~strike~~</code></td><td><s>strike</s></td></tr>
                  <tr><td><code>`inline code`</code></td><td><code>inline code</code></td></tr>
                  <tr><td><code>```code block```</code></td><td><pre style={{ margin: 0, fontSize: 12 }}>code block</pre></td></tr>
                  <tr><td><code>[link](url)</code></td><td><a href="#">link</a></td></tr>
                  <tr><td><code>![alt](image-url)</code></td><td>Image embed</td></tr>
                  <tr><td><code># Heading</code></td><td><strong style={{ fontSize: 16 }}>Heading</strong></td></tr>
                  <tr><td><code>&gt; quote</code></td><td style={{ borderLeft: '3px solid var(--mc-border)', paddingLeft: 8 }}>quote</td></tr>
                  <tr><td><code>- item</code></td><td>{'• item'}</td></tr>
                  <tr><td><code>---</code></td><td><hr style={{ margin: '4px 0' }} /></td></tr>
                </tbody>
              </table>
            )}
            {activeTab === 'server' && (
              serverConfig ? (
                <div class={styles.configSection}>
                  <h4 class={styles.configHeading}>ICE Servers</h4>
                  <pre class={styles.configPre}>{JSON.stringify(serverConfig.iceServers, null, 2)}</pre>

                  <h4 class={styles.configHeading}>Audio</h4>
                  <table class={styles.cheatsheet}>
                    <tbody>
                      <tr><td>Echo Cancellation</td><td>{String(serverConfig.audio.echo_cancellation)}</td></tr>
                      <tr><td>Noise Suppression</td><td>{String(serverConfig.audio.noise_suppression)}</td></tr>
                      <tr><td>Auto Gain Control</td><td>{String(serverConfig.audio.auto_gain_control)}</td></tr>
                      <tr><td>Opus Bitrate</td><td>{serverConfig.audio.opus_bitrate} bps</td></tr>
                      <tr><td>Opus Stereo</td><td>{String(serverConfig.audio.opus_stereo)}</td></tr>
                    </tbody>
                  </table>

                  <h4 class={styles.configHeading}>Screenshare</h4>
                  <table class={styles.cheatsheet}>
                    <tbody>
                      <tr><td>Resolution</td><td>{serverConfig.screenshare.width}×{serverConfig.screenshare.height}</td></tr>
                      <tr><td>Frame Rate</td><td>{serverConfig.screenshare.frameRate} fps</td></tr>
                    </tbody>
                  </table>

                  <h4 class={styles.configHeading}>Media Processing</h4>
                  <table class={styles.cheatsheet}>
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
              ) : (
                <p style={{ color: 'var(--mc-text-muted)', fontSize: '0.85rem' }}>Loading server config…</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopLayout({ chat, voice, screenshare, user, logout, updateProfile, uploadAvatar, channelsState }) {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [showHelp, setShowHelp] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div class="window glass active" style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', '--w7-w-bg': 'var(--mc-window-glass)' }}>
      {!isPwa && (
        <div class="title-bar" style={{ backgroundAttachment: 'local', flexShrink: 0 }}>
          <div class="title-bar-text">{UI_CONFIG.name}</div>
          <div class="title-bar-controls">
            <button aria-label="Help" onClick={() => setShowHelp(true)} />
            <button aria-label="Close" title="Logout" onClick={logout} />
          </div>
        </div>
      )}
      <div class={styles.body}>
        <div class={styles.shell}>
          <Sidebar
            voice={voice}
            user={user}
            onUpdateProfile={updateProfile}
            onUploadAvatar={uploadAvatar}
            onLogout={logout}
            screenshare={screenshare}
            style={{ width: sidebarWidth, minWidth: sidebarWidth }}
            channels={channelsState.channels}
            onDeleteChannel={channelsState.deleteChannel}
            usersMap={chat.usersMap}
          />
          <div class={styles.resizeHandle} onMouseDown={onMouseDown} />
          <div class={styles.mainArea}>
            <ChatPanel
              chat={chat}
              screenshare={screenshare}
              currentUser={user}
              showMembers={showMembers}
              onToggleMembers={() => setShowMembers((v) => !v)}
              channels={channelsState.channels}
              activeChannelId={channelsState.activeChannelId}
              onSelectChannel={channelsState.setActiveChannelId}
              onCreateChannel={channelsState.createChannel}
              onRenameChannel={channelsState.renameChannel}
              onDeleteChannel={channelsState.deleteChannel}
              unreadCounts={channelsState.unreadCounts}
            />
            {showMembers && (
              <MembersSidebar usersMap={chat.usersMap} onlineUserIds={chat.onlineUserIds} currentUser={user} setUserAdmin={chat.setUserAdmin} />
            )}
          </div>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

function AuthenticatedApp({ user, setUser, logout, updateProfile, uploadAvatar }) {
  const channelsState = useChannels();
  const chat = useChat(user, setUser, channelsState.activeChannelId);
  const voice = useVoice(user);
  const screenshare = useScreenshare(user, voice.participants, voice.isJoined);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobileLayout
        chat={chat}
        voice={voice}
        screenshare={screenshare}
        user={user}
        onUpdateProfile={updateProfile}
        onUploadAvatar={uploadAvatar}
        onLogout={logout}
        channelsState={channelsState}
      />
    );
  }

  return (
    <DesktopLayout
      chat={chat}
      voice={voice}
      screenshare={screenshare}
      user={user}
      logout={logout}
      updateProfile={updateProfile}
      uploadAvatar={uploadAvatar}
      channelsState={channelsState}
    />
  );
}

export function App() {
  const { user, setUser, ready, error, register, login, logout, updateProfile, uploadAvatar } = useUser();

  if (!user) {
    if (!ready) return null;
    return <LoginScreen onRegister={register} onLogin={login} error={error} />;
  }

  return (
    <RealtimeProvider user={user}>
      <AuthenticatedApp
        user={user}
        setUser={setUser}
        logout={logout}
        updateProfile={updateProfile}
        uploadAvatar={uploadAvatar}
      />
    </RealtimeProvider>
  );
}
