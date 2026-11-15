import { useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { usePreferences } from '../preferences-context';
import { formatSettingsDate } from '../settings-date';
import {
  fetchSecuritySettings, requestPasswordReset, resetMfa,
  type SecuritySettings as SecurityData,
} from '../settings.api';

export default function SecuritySettings() {
  const { state, getAccessToken, signOut } = useAppAuth();
  const { preferences } = usePreferences();
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<'password' | 'mfa' | null>(null);
  const [retry, setRetry] = useState(0);
  const canManage = state.status === 'authenticated' && state.user.permissions.includes('settings.manage_self');
  const development = state.mode === 'development' || security?.sign_in_method === 'development';

  useEffect(() => {
    const controller = new AbortController();
    fetchSecuritySettings(getAccessToken, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) { setSecurity(data); setError(''); }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Security could not load.');
      });
    return () => controller.abort();
  }, [getAccessToken, retry]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function perform(action: 'password' | 'mfa') {
    if (pending) return;
    if (action === 'mfa' && !window.confirm('Reset your MFA enrollment? You may need to enroll again at sign-in.')) return;
    setPending(action);
    setError('');
    setMessage('');
    try {
      const result = await (action === 'password' ? requestPasswordReset(getAccessToken) : resetMfa(getAccessToken));
      setMessage(result.message);
      if (action === 'mfa') setRetry((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Security request failed. Try again.');
    } finally {
      setPending(null);
    }
  }

  const lastLogin = formatSettingsDate(security?.last_login ?? null, security?.timezone ?? 'Europe/Budapest', preferences);

  return <section className="card settings-panel" aria-labelledby="security-settings-title">
    <div className="settings-panel-header"><h2 id="security-settings-title">Security</h2>
      <p>Manage your sign-in and account protection.</p></div>
    {error && <div className="settings-error" role="alert">{error}{!security && <button
      type="button" className="btn btn-secondary" onClick={() => setRetry((value) => value + 1)}>Retry</button>}</div>}
    {message && <p className="settings-success" role="status">{message}</p>}
    {!security && !error && <p role="status">Loading security settings...</p>}
    {development ? <div className="settings-security-section"><h3>Development account</h3>
      <p>Development account — security settings unavailable.</p></div> : security && <>
      <div className="settings-security-section"><h3>Sign-in method</h3>
        <p>Auth0 · {security.identity_provider}</p>
        {security.password_reset_available ? <>
          <p className="settings-note">Auth0 sends a secure reset email. Compass never handles your password.</p>
          <button className="btn btn-secondary" type="button" disabled={!canManage || !!pending}
            onClick={() => void perform('password')}>{pending === 'password' ? 'Sending...' : 'Send password reset email'}</button>
        </> : <p className="settings-note">Password changes are managed by your sign-in provider or organization.</p>}
      </div>
      <div className="settings-security-section"><h3>Multi-factor authentication</h3>
        {security.mfa_available ? <>
          <p>{security.enrolled_factors.length ? security.enrolled_factors.join(', ') : 'No enrolled factors reported.'}</p>
          <button className="btn btn-secondary" type="button" disabled={!canManage || !!pending}
            onClick={() => void perform('mfa')}>{pending === 'mfa' ? 'Resetting...' : 'Reset MFA enrollment'}</button>
        </> : <p>MFA is managed by your organization.</p>}
      </div>
    </>}
    <div className="settings-security-section"><h3>Sessions</h3>
      <div className="settings-field"><span>Last sign-in{security ? ` (${security.timezone})` : ''}</span>
        <strong>{lastLogin}</strong></div>
      <button className="btn btn-secondary" type="button" onClick={signOut}>Sign out on this device</button>
    </div>
  </section>;
}
