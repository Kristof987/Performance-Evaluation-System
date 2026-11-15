import { createContext, useContext } from 'react';
import type { Preferences } from './settings.api';

export type PreferenceState = {
  preferences: Preferences;
  loading: boolean;
  error: string;
  retry: () => void;
  save: (changes: Partial<Preferences>) => Promise<Preferences>;
};

export const PreferencesContext = createContext<PreferenceState | null>(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('PreferencesProvider is required');
  return context;
}
