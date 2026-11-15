import { NavLink } from 'react-router';
import { canOpenSection, SETTINGS_GROUPS } from './settings-sections';

export default function SettingsNavigation({ permissions }: { permissions: string[] }) {
  return <nav className="settings-navigation" aria-label="Settings sections">
    {SETTINGS_GROUPS.map((group) => {
      const items = group.items.filter((item) => canOpenSection(item.id, permissions));
      if (!items.length) return null;
      return <div className="settings-nav-group" key={group.label}>
        <span className="settings-nav-heading">{group.label}</span>
        {items.map(({ id, label, description, icon: Icon }) => <NavLink key={id} to={`/settings/${id}`}
          className={({ isActive }) => isActive ? 'settings-nav-item active' : 'settings-nav-item'}>
          <Icon size={18} aria-hidden="true" /><div><strong>{label}</strong><span>{description}</span></div>
        </NavLink>)}
      </div>;
    })}
  </nav>;
}
