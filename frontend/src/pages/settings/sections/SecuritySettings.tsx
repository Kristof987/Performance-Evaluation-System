import { useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { useDates, zoneLabel } from '../../../app/dates';
import InlineMessage from '../../../components/feedback/InlineMessage';
import LoadError from '../../../components/feedback/LoadError';
import { useToast } from '../../../components/feedback/feedback-context';
import Pending from '../../../components/feedback/Pending';
import LoadingState from '../../../components/feedback/LoadingState';
import {
  fetchSecuritySettings, requestPasswordReset,
  type SecuritySettings as SecurityData,
} from '../settings.api';

export default function SecuritySettings() {
  const toast = useToast();
  const { state, getAccessToken, signOut } = useAppAuth();
  const dates = useDates();
  const [security, setSecurity] = useState<SecurityData | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
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

  async function sendPasswordReset() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const result = await requestPasswordReset(getAccessToken);
      toast.success(result.message.replace(/\.$/, ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Security request failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  const lastLogin = dates.dateTime(security?.last_login, 'Not available');

  return <section className="card settings-panel" aria-labelledby="security-settings-title">
    <div className="settings-panel-header"><h2 id="security-settings-title">Security</h2>
      <p>Manage your sign-in and account protection.</p></div>
    {error && (security ? <InlineMessage tone="error" onDismiss={() => setError('')}>{error}</InlineMessage>
      : <LoadError message={error} onRetry={() => setRetry((value) => value + 1)} />)}
        {!security && !error && <LoadingState variant="section" label="Loading security settings" />}
    {development ? <div className="settings-security-section"><h3>Development account</h3>
      <p>Development account — security settings unavailable.</p></div> : security && <>
      <div className="settings-security-section"><h3>Sign-in method</h3>
        <p>Auth0 · {security.identity_provider}</p>
        {security.password_reset_available ? <>
          <p className="settings-note">Auth0 sends a secure reset email. Mirra never handles your password.</p>
          <button className="btn btn-secondary" type="button" disabled={!canManage || pending}
            onClick={() => void sendPasswordReset()}>{pending ? <Pending label="Sending" /> : 'Send password reset email'}</button>
        </> : <p className="settings-note">Password changes are managed by your sign-in provider or organization.</p>}
      </div>
    </>}
    <div className="settings-security-section"><h3>Sessions</h3>
      <div className="settings-field"><span>Last sign-in ({zoneLabel(dates.settings)})</span>
        <strong>{lastLogin}</strong></div>
      <button className="btn btn-secondary" type="button" onClick={signOut}>Sign out on this device</button>
    </div>
  </section>;
}
