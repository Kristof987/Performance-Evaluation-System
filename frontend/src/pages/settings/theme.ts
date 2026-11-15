import type { Preferences } from './settings.api';

export function cachedTheme(): Preferences['theme'] {
  try {
    const value = localStorage.getItem('compass.theme');
    return value === 'dark' || value === 'light' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Preferences['theme']) {
  const dark = theme === 'dark' || theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('compass.theme', theme); } catch { /* Storage may be disabled. */ }
}
