import { useState, useCallback, useEffect } from 'preact/hooks';

const STORAGE_KEY = 'mc-theme';

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function getStoredTheme() {
  return localStorage.getItem(STORAGE_KEY) || 'light';
}

export function initTheme() {
  applyTheme(getStoredTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme);

  const setTheme = useCallback((next) => {
    const resolved = next === 'system' ? getSystemPreference() : next;
    setThemeState(resolved);
    localStorage.setItem(STORAGE_KEY, resolved);
    applyTheme(resolved);
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}

function getSystemPreference() {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}
