import { Navigate, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import SettingsNavigation, { type SettingsSection } from './SettingsNavigation';
import ProfileSettings from './sections/ProfileSettings';
import SecuritySettings from './sections/SecuritySettings';
import { fetchAccountSettingsProfile, type AccountSettingsProfile } from './settings.api';
import './settings.css';
import { usePreferences } from './preferences-context';
import PreferenceSettings from './sections/PreferenceSettings';

function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value === 'profile' || value === 'security' || value === 'notifications' || value === 'appearance';
}

export default function SettingsPage() {
  const { section } = useParams();
  const { state, getAccessToken } = useAppAuth();
  const preferenceState = usePreferences();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  const [result, setResult] = useState<{
    owner: number; profile: AccountSettingsProfile | null; error: string;
  } | null>(null);
  const profile = result?.owner === userId ? result.profile : null;
  const error = result?.owner === userId ? result.error : '';

  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    fetchAccountSettingsProfile(getAccessToken, controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted) setResult({ owner: userId, profile, error: '' });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const error = cause instanceof ApiAccessError
          ? cause.status === 401 ? 'Your session expired. Sign in again to view Settings.'
            : 'You do not have permission to view Settings.'
          : cause instanceof Error ? cause.message : 'Settings could not be loaded.';
        setResult({ owner: userId, profile: null, error });
      });
    return () => controller.abort();
  }, [userId, getAccessToken]);

  if (!isSettingsSection(section)) return <Navigate to="/settings/profile" replace />;

  const loading = userId !== null && profile === null && error === '';

  return <AppLayout activePage="settings" pageClassName="settings-page">
    <main className="main-content settings-main">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>Manage your account and preferences.</p>
      </header>
      <div className="settings-layout">
        <SettingsNavigation />
        <div className="settings-content">
          {userId === null && <div className="card card-padded settings-state" role="alert">Sign in again to view settings.</div>}
          {loading && <div className="card card-padded settings-state">Loading settings...</div>}
          {error && <div className="card card-padded settings-state settings-error" role="alert">{error}</div>}
          {profile && section === 'profile' && <ProfileSettings profile={profile} />}
          {profile && section === 'security' && <SecuritySettings />}
          {profile && (section === 'notifications' || section === 'appearance') && (
            preferenceState.loading ? <div className="card card-padded" role="status">Loading preferences...</div>
              : preferenceState.error ? <div className="card card-padded settings-error" role="alert">
                {preferenceState.error}<button className="btn btn-secondary" type="button"
                  onClick={preferenceState.retry}>Retry</button></div>
                : <PreferenceSettings key={`${userId}:${section}`} section={section} />
          )}
        </div>
      </div>
    </main>
  </AppLayout>;
}
