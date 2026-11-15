import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppAuth } from '../../auth/AppAuth';
import { defaultPreferences, fetchPreferences, patchPreferences, type Preferences } from './settings.api';
import { applyTheme, cachedTheme } from './theme';
import { PreferencesContext } from './preferences-context';

export default function PreferencesProvider({ children }: { children: ReactNode }) {
  const { state, getAccessToken } = useAppAuth();
  const owner = state.status === 'authenticated' ? state.user.id : null;
  const canRead = state.status === 'authenticated' && state.user.permissions.includes('settings.read');
  const [result, setResult] = useState<{ owner: number; preferences: Preferences } | null>(null);
  const [failure, setFailure] = useState<{ owner: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pendingSave = useRef<AbortController | null>(null);
  const preferences = result?.owner === owner && result
    ? result.preferences : { ...defaultPreferences, theme: cachedTheme() };
  const error = failure?.owner === owner && failure ? failure.message : '';
  const loading = !!canRead && result?.owner !== owner && !error;

  useEffect(() => {
    return () => { pendingSave.current?.abort(); };
  }, [owner]);

  useEffect(() => {
    if (owner === null || !canRead) return;
    const controller = new AbortController();
    fetchPreferences(getAccessToken, controller.signal)
      .then((preferences) => {
        if (!controller.signal.aborted) { setResult({ owner, preferences }); setFailure(null); }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setFailure({
          owner, message: cause instanceof Error ? cause.message : 'Preferences could not be loaded.',
        });
      });
    return () => controller.abort();
  }, [owner, canRead, getAccessToken, attempt]);

  useEffect(() => {
    applyTheme(preferences.theme);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function onChange() { if (preferences.theme === 'system') applyTheme('system'); }
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [preferences.theme]);

  async function save(changes: Partial<Preferences>) {
    if (owner === null) throw new Error('Sign in again to save preferences.');
    pendingSave.current?.abort();
    const controller = new AbortController();
    pendingSave.current = controller;
    const previous = preferences;
    setResult({ owner, preferences: { ...previous, ...changes } });
    applyTheme(changes.theme ?? previous.theme);
    try {
      const saved = await patchPreferences(getAccessToken, changes, controller.signal);
      if (!controller.signal.aborted) setResult({ owner, preferences: saved });
      return saved;
    } catch (cause) {
      if (!controller.signal.aborted) {
        setResult({ owner, preferences: previous });
        applyTheme(previous.theme);
      }
      throw cause;
    } finally {
      if (pendingSave.current === controller) pendingSave.current = null;
    }
  }

  return <PreferencesContext.Provider value={{
    preferences, loading, error, retry: () => setAttempt((value) => value + 1), save,
  }}>{children}</PreferencesContext.Provider>;
}
