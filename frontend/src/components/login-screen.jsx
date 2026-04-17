import { useState } from 'preact/hooks';
import { APP_NAME } from '../constants.js';
import styles from './login-screen.module.css';

export function LoginScreen({ onRegister, onLogin, error }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !password || loading) return;

    setLoading(true);
    if (isLoginMode) {
      await onLogin(name.trim(), password);
    } else {
      await onRegister(name.trim(), password, passphrase.trim());
    }
    setLoading(false);
  };

  const canSubmit = isLoginMode
    ? name.trim() && password.length >= 6
    : name.trim() && password.length >= 6 && passphrase.trim();

  return (
    <div class={styles.container}>
      <div class="window glass active" style={{ width: 380, '--w7-w-bg': '#2e8b3a' }}>
        <div class="title-bar">
          <div class="title-bar-text">{APP_NAME}</div>
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
                maxLength={40}
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
                  maxLength={32}
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
