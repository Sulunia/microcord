import { useState, useCallback, useRef } from 'preact/hooks';
import { Sidebar } from './components/sidebar/sidebar.jsx';
import { ChatPanel } from './components/chat/chat-panel.jsx';
import { MembersSidebar } from './components/chat/members-sidebar.jsx';
import { LoginScreen } from './components/login-screen.jsx';
import { MobileLayout } from './components/mobile/mobile-layout.jsx';
import { useUser } from './hooks/use-user.js';
import { useChat } from './hooks/use-chat.js';
import { useChannels } from './hooks/use-channels.js';
import { useVoice } from './hooks/use-voice.js';
import { useVoiceChannels } from './hooks/use-voice-channels.js';
import { useScreenshare } from './hooks/use-screenshare.js';
import { useIsMobile } from './hooks/use-is-mobile.js';
import { RealtimeProvider } from './hooks/realtime.jsx';
import { UI_CONFIG, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from './constants.js';
import { ServerConfigView } from './components/server-config-view.jsx';
import styles from './app.module.css';

const standaloneQuery = window.matchMedia('(display-mode: standalone), (display-mode: minimal-ui), (display-mode: fullscreen)');
const isPwa = standaloneQuery.matches || window.navigator.standalone === true;

function HelpModal({ onClose }) {
  const [activeTab, setActiveTab] = useState('markdown');

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
            {activeTab === 'server' && <ServerConfigView />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopLayout({ chat, voice, screenshare, user, logout, updateProfile, uploadAvatar, channelsState, voiceChannelsState }) {
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
            voiceChannels={voiceChannelsState.voiceChannels}
            onCreateVoiceChannel={voiceChannelsState.createVoiceChannel}
            onDeleteVoiceChannel={voiceChannelsState.deleteVoiceChannel}
            onJoinVoiceChannel={voice.joinChannel}
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
  const voiceChannelsState = useVoiceChannels();

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
        voiceChannelsState={voiceChannelsState}
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
      voiceChannelsState={voiceChannelsState}
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
