import { useState, useCallback, useRef } from 'preact/hooks';
import { Sidebar } from './components/sidebar/sidebar.jsx';
import { ChatPanel } from './components/chat/chat-panel.jsx';
import { LoginScreen } from './components/login-screen.jsx';
import { useUser } from './hooks/use-user.js';
import { useChat } from './hooks/use-chat.js';
import { useVoice } from './hooks/use-voice.js';
import { useScreenshare } from './hooks/use-screenshare.js';
import { UI_CONFIG, APP_VERSION } from './constants.js';
import styles from './app.module.css';

const MIN_SIDEBAR = 180;
const MAX_SIDEBAR = 480;
const DEFAULT_SIDEBAR = 240;

function HelpModal({ onClose }) {
  return (
    <div class={styles.overlay} onClick={onClose}>
        <div class="window glass active" style={{ width: 420, maxHeight: '80vh', '--w7-w-bg': 'var(--mc-window-glass)' }} onClick={(e) => e.stopPropagation()}>
        <div class="title-bar">
          <div class="title-bar-text">Markdown Cheatsheet</div>
          <div class="title-bar-controls">
            <button aria-label="Close" onClick={onClose} />
          </div>
        </div>
        <div class="window-body has-space" style={{ overflow: 'auto', maxHeight: 'calc(80vh - 40px)' }}>
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
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 11, color: 'var(--mc-text-muted, #999)' }}>Microcord {APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { user, ready, error, register, login, logout, updateProfile, uploadAvatar } = useUser();
  const chat = useChat(user);
  const voice = useVoice(user, chat.ws);
  const screenshare = useScreenshare(user, chat.ws, voice.participants, voice.isJoined);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const [showHelp, setShowHelp] = useState(false);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (e) => {
      if (!dragging.current) return;
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX));
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

  if (!user) {
    if (!ready) return null;
    return <LoginScreen onRegister={register} onLogin={login} error={error} />;
  }

  return (
    <div class="window glass active" style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', flexDirection: 'column', '--w7-w-bg': 'var(--mc-window-glass)' }}>
      <div class="title-bar" style={{ backgroundAttachment: 'local', flexShrink: 0 }}>
        <div class="title-bar-text">{UI_CONFIG.name}</div>
        <div class="title-bar-controls">
          <button aria-label="Help" onClick={() => setShowHelp(true)} />
          <button aria-label="Close" title="Logout" onClick={logout} />
        </div>
      </div>
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
          />
          <div class={styles.resizeHandle} onMouseDown={onMouseDown} />
          <ChatPanel chat={chat} screenshare={screenshare} />
        </div>
      </div>
      <div class={styles.statusBar}>
        <span>{UI_CONFIG.tagline}</span>
        <span>v{APP_VERSION}</span>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
