import { useState } from 'preact/hooks';
import { UI_CONFIG, MAX_DISPLAY_NAME_LENGTH, MIN_PASSWORD_LENGTH, MAX_PASSPHRASE_LENGTH } from '../constants.js';
import styles from './login-screen.module.css';

export function LoginScreen({ onRegister, onLogin, error }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isFormIncomplete = !name.trim() || !password;
    if (isFormIncomplete || loading) return;

    setLoading(true);
    if (isLoginMode) {
      await onLogin(name.trim(), password);
    } else {
      await onRegister(name.trim(), password, passphrase.trim());
    }
    setLoading(false);
  };

  const hasName = Boolean(name.trim());
  const hasPassword = password.length >= MIN_PASSWORD_LENGTH;
  const hasPassphrase = Boolean(passphrase.trim());
  const canSubmit = isLoginMode
    ? hasName && hasPassword
    : hasName && hasPassword && hasPassphrase;

  return (
    <div class={styles.container}>
      <div class="window glass active" style={{ width: 380, '--w7-w-bg': 'var(--mc-window-glass)' }}>
        <div class="title-bar">
          <div class="title-bar-text">{UI_CONFIG.name}</div>
        </div>
        <div class="window-body has-space">
          <form class={styles.card} onSubmit={handleSubmit}>
            <p class={styles.subtitle}>
              {isLoginMode ? 'Log in to continue' : 'Create an account to get started'}
            </p>
            <div class={styles.fieldGroup}>
              <label for="login-name">Username</label>
              <input
                id="login-name"
                type="text"
                value={name}
                onInput={(e) => setName(e.target.value)}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                autoFocus
              />
            </div>
            <div class={styles.fieldGroup}>
              <label for="login-pw">Password</label>
              <input
                id="login-pw"
                type="password"
                value={password}
                onInput={(e) => setPassword(e.target.value)}
              />
            </div>
            {!isLoginMode && (
              <div class={styles.fieldGroup}>
                <label for="login-passphrase">Server Passphrase</label>
                <input
                  id="login-passphrase"
                  type="password"
                  value={passphrase}
                  onInput={(e) => setPassphrase(e.target.value)}
                  placeholder="Ask the server admin"
                  maxLength={MAX_PASSPHRASE_LENGTH}
                />
              </div>
            )}
            {error && <p class={styles.error}>{error}</p>}
            <button
              type="submit"
              disabled={!canSubmit || loading}
            >
              {loading ? 'Please wait...' : (isLoginMode ? 'Log in' : 'Create Account')}
            </button>
            <button
              type="button"
              class={styles.switchLink}
              onClick={() => setIsLoginMode(!isLoginMode)}
            >
              {isLoginMode ? "Don't have an account? Register" : 'Already have an account? Log in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
