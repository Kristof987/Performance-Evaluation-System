import { Navigate, useParams } from 'react-router';
import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import SettingsNavigation from './SettingsNavigation';
import { canOpenSection, isSettingsSection, SETTINGS_GROUPS } from './settings-sections';
import { usePageTitle } from '../../app/usePageTitle';
import ProfileSettings from './sections/ProfileSettings';
import SecuritySettings from './sections/SecuritySettings';
import PreferenceSettings from './sections/PreferenceSettings';
import PrivacySettings from './sections/PrivacySettings';
import AISettings from './sections/AISettings';
import EmailReminderSettings from './sections/EmailReminderSettings';
import PermissionsSettings from './sections/PermissionsSettings';
import AuditLogSettings from './sections/AuditLogSettings';
import { fetchAccountSettingsProfile, type AccountSettingsProfile } from './settings.api';
import { usePreferences } from './preferences-context';
import './settings.css';
import InlineMessage from '../../components/feedback/InlineMessage';
import LoadError from '../../components/feedback/LoadError';

export default function SettingsPage() {
  const { section } = useParams();
  const { state, getAccessToken } = useAppAuth();
  const preferenceState = usePreferences();
  const userId = state.status === 'authenticated' ? state.user.id : null;
  const permissions = state.status === 'authenticated' ? state.user.permissions : [];
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

  const sectionLabel = SETTINGS_GROUPS.flatMap((group) => group.items).find((item) => item.id === section)?.label;
  usePageTitle(sectionLabel, 'Settings');

  if (!isSettingsSection(section)) return <Navigate to="/settings/profile" replace />;
  if (userId !== null && !canOpenSection(section, permissions)) return <Navigate to="/settings/profile" replace />;

  const loading = userId !== null && profile === null && error === '';
  const workspace = section === 'privacy' || section === 'emails' || section === 'ai' || section === 'permissions' || section === 'audit';

  return <AppLayout activePage="settings" pageClassName="settings-page">
    <main className="main-content settings-main">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>Manage your account, preferences and workspace.</p>
      </header>
      <div className="settings-layout">
        <SettingsNavigation permissions={permissions} />
        <div className="settings-content">
          {userId === null && <InlineMessage tone="error">Sign in again to view settings.</InlineMessage>}
          {userId !== null && workspace && <>
            {section === 'privacy' && <PrivacySettings />}
            {section === 'emails' && <EmailReminderSettings />}
            {section === 'ai' && <AISettings />}
            {section === 'permissions' && <PermissionsSettings />}
            {section === 'audit' && <AuditLogSettings />}
          </>}
          {!workspace && loading && <div className="card card-padded settings-state">Loading settings...</div>}
          {!workspace && error && <InlineMessage tone="error">{error}</InlineMessage>}
          {!workspace && profile && section === 'profile' && <ProfileSettings profile={profile} />}
          {!workspace && profile && section === 'security' && <SecuritySettings />}
          {!workspace && profile && (section === 'notifications' || section === 'appearance') && (
            preferenceState.loading ? <div className="card card-padded" role="status">Loading preferences...</div>
              : preferenceState.error ? <LoadError message={preferenceState.error} onRetry={preferenceState.retry} />
                : <PreferenceSettings key={`${userId}:${section}`} section={section} />
          )}
        </div>
      </div>
    </main>
  </AppLayout>;
}
