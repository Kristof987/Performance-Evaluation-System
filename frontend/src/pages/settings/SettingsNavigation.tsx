import { NavLink } from 'react-router';
import { Bell, Palette, ShieldCheck, UserRound } from 'lucide-react';

export type SettingsSection = 'profile' | 'security' | 'notifications' | 'appearance';

const sections: { id: SettingsSection; label: string; description: string }[] = [
  { id: 'profile', label: 'My profile', description: 'Account details' },
  { id: 'security', label: 'Security', description: 'Sign-in status' },
  { id: 'notifications', label: 'Notifications', description: 'Update preferences' },
  { id: 'appearance', label: 'Appearance', description: 'Theme and display' },
];

const icons = { profile: UserRound, security: ShieldCheck, notifications: Bell, appearance: Palette };

export default function SettingsNavigation() {
  return <nav className="settings-navigation" aria-label="Settings sections">
    {sections.map((section) => {
      const Icon = icons[section.id];
      return <NavLink key={section.id} to={`/settings/${section.id}`}
        className={({ isActive }) => isActive ? 'settings-nav-item active' : 'settings-nav-item'}>
        <Icon size={18} aria-hidden="true" /><div><strong>{section.label}</strong><span>{section.description}</span></div>
      </NavLink>;
    })}
  </nav>;
}
