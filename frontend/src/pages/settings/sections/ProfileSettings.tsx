import { formatUserName } from '../../layout/sidebar-user';
import type { AccountSettingsProfile } from '../settings.api';

function Field({ label, value }: { label: string; value: string }) {
  return <div className="settings-field"><span>{label}</span><strong>{value}</strong></div>;
}

export default function ProfileSettings({ profile }: { profile: AccountSettingsProfile }) {
  return <section className="card settings-panel" aria-labelledby="profile-settings-title">
    <div className="settings-panel-header">
      <h2 id="profile-settings-title">My profile</h2>
      <p>Your account information is managed by your organization.</p>
    </div>
    <div className="settings-field-grid">
       <Field label="Full name" value={profile.full_name || formatUserName(profile.username)} />
      <Field label="Email address" value={profile.email} />
      <Field label="Company role" value={profile.company_role || 'Not assigned'} />
      <Field label="System role" value={profile.system_role || 'Not assigned'} />
      <Field label="Account status" value={profile.is_active ? 'Active' : 'Inactive'} />
    </div>
    <div className="settings-groups-block">
      <span>Company groups</span>
      {profile.groups.length === 0 ? <p>No group memberships assigned.</p> : <div className="settings-group-list">
        {profile.groups.map((group) => <span className="settings-group-chip" key={group.id}>{group.name}</span>)}
      </div>}
    </div>
    <p className="settings-note">Contact your HR administrator to update your account information.</p>
  </section>;
}
