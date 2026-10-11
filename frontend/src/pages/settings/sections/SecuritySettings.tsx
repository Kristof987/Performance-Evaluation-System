import type { AccountSettingsProfile } from '../settings.api';

function formatDateTime(value: string | null) {
  if (value === null) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function SecuritySettings({ profile }: { profile: AccountSettingsProfile }) {
  return <section className="card settings-panel" aria-labelledby="security-settings-title">
    <div className="settings-panel-header">
      <h2 id="security-settings-title">Security</h2>
      <p>Review the account security controls supported by this Compass workspace.</p>
    </div>
    <div className="settings-security-section">
      <h3>Password and sign-in</h3>
      <p>Password changes are not available in Settings yet because this workspace does not currently verify passwords during sign-in or use a secure password hashing workflow.</p>
      <p className="settings-note">Ask your HR administrator to manage access until secure local password authentication or an external identity provider is configured.</p>
    </div>
    <div className="settings-security-section">
      <h3>Active session</h3>
      <div className="settings-field-grid compact">
        <div className="settings-field"><span>Current status</span><strong>Signed in on this browser</strong></div>
        <div className="settings-field"><span>Last sign-in recorded</span><strong>{formatDateTime(profile.last_login)}</strong></div>
      </div>
      <p className="settings-note">Server-side session revocation is not currently supported, so Settings does not show a fake session termination control.</p>
    </div>
  </section>;
}
