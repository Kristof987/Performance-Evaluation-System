import { NavLink } from 'react-router';

export type SettingsSection = 'profile' | 'security';

const sections: { id: SettingsSection; label: string; description: string }[] = [
  { id: 'profile', label: 'My profile', description: 'Account details' },
  { id: 'security', label: 'Security', description: 'Sign-in status' },
];

export default function SettingsNavigation() {
  return <nav className="settings-navigation" aria-label="Settings sections">
    {sections.map((section) => <NavLink key={section.id} to={`/settings/${section.id}`} className={({ isActive }) => isActive ? 'settings-nav-item active' : 'settings-nav-item'}>
      <strong>{section.label}</strong>
      <span>{section.description}</span>
    </NavLink>)}
  </nav>;
}
