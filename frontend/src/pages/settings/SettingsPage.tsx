import { Navigate, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import { getSidebarUser } from '../layout/sidebar-user';
import SettingsNavigation, { type SettingsSection } from './SettingsNavigation';
import ProfileSettings from './sections/ProfileSettings';
import SecuritySettings from './sections/SecuritySettings';
import { fetchAccountSettingsProfile, type AccountSettingsProfile } from './settings.api';
import './settings.css';

function isSettingsSection(value: string | undefined): value is SettingsSection {
  return value === 'profile' || value === 'security';
}

export default function SettingsPage() {
  const { section } = useParams();
  const user = getSidebarUser();
  const userId = user?.id ?? null;
  const [profile, setProfile] = useState<AccountSettingsProfile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (userId === null) return;
    const controller = new AbortController();
    fetchAccountSettingsProfile(userId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setProfile(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) { setProfile(null); setError(cause instanceof Error ? cause.message : 'Settings could not be loaded.'); } });
    return () => controller.abort();
  }, [userId]);

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
          {profile && section === 'security' && <SecuritySettings profile={profile} />}
        </div>
      </div>
    </main>
  </AppLayout>;
}
