import { useState, useEffect, useCallback } from 'preact/hooks';
import { API_BASE, USER_STORAGE_KEY, TOKEN_STORAGE_KEY } from '../constants.js';

function loadStored(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function useUser() {
  const [user, setUser] = useState(loadStored(USER_STORAGE_KEY));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const token = getToken();
    if (!token) { setUser(null); setReady(true); return; }

    fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error('expired');
        return r.json();
      })
      .then((data) => {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
        setUser(data);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        setUser(null);
      })
      .finally(() => setReady(true));
  }, []);

  const register = useCallback(async (name, password, passphrase) => {
    setError(null);
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password, passphrase }),
    });
    if (res.status === 409) { setError('Username already taken'); return false; }
    if (res.status === 403) { setError('Invalid server passphrase'); return false; }
    if (res.status === 429) { setError('Too many attempts. Wait a moment.'); return false; }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Registration failed');
      return false;
    }
    const { user: userData, token } = await res.json();
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    setUser(userData);
    return true;
  }, []);

  const login = useCallback(async (name, password) => {
    setError(null);
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password }),
    });
    if (res.status === 429) { setError('Too many attempts. Wait a moment.'); return false; }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Login failed');
      return false;
    }
    const { user: userData, token } = await res.json();
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
    setUser(userData);
    return true;
  }, []);

  const logout = useCallback(() => {
    const token = getToken();
    if (token) {
      fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setUser(null);
  }, []);

  const updateProfile = useCallback(async (nextUser) => {
    if (!user) return false;

    const payload = {};
    if (typeof nextUser?.display_name === 'string') {
      const dn = nextUser.display_name.trim();
      if (!dn) return false;
      payload.display_name = dn;
    }

    if (typeof nextUser?.tick_sound === 'number') {
      payload.tick_sound = nextUser.tick_sound;
    }

    const res = await fetch(`${API_BASE}/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return false;

    const updated = await res.json();
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
    setUser(updated);
    return true;
  }, [user]);

  const uploadAvatar = useCallback(async (file) => {
    if (!user || !file) return false;

    const form = new FormData();
    form.append('file', file);

    const res = await fetch(`${API_BASE}/avatar`, {
      method: 'POST',
      headers: authHeaders(),
      body: form,
    });

    if (!res.ok) return false;

    const updated = await res.json();
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated));
    setUser(updated);
    return true;
  }, [user]);

  return { user, ready, error, register, login, logout, updateProfile, uploadAvatar };
}
