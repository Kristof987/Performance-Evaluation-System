import type { SidebarPage } from '../pages/layout/Sidebar';

/**
 * Which permissions each area needs. The route guard in main.tsx and the sidebar menu both read
 * this table, so a page and its menu entry can never disagree.
 */
export type AccessRule = { permissions: string[]; feature: string; activePage: SidebarPage };

export const ACCESS = {
  evaluations: { permissions: ['evaluations.read_assigned'], feature: 'Evaluations', activePage: 'my-evaluations' },
  people: { permissions: ['employees.read', 'groups.read'], feature: 'People', activePage: 'people' },
  campaigns: { permissions: ['campaigns.read'], feature: 'Campaigns', activePage: 'campaigns' },
  completion: { permissions: ['campaigns.read'], feature: 'Completion status', activePage: 'campaigns' },
  forms: { permissions: ['forms.read', 'sections.read'], feature: 'Forms', activePage: 'forms' },
  reports: { permissions: ['reports.read'], feature: 'Reports', activePage: 'reports' },
  settings: { permissions: ['settings.read'], feature: 'Settings', activePage: 'settings' },
} satisfies Record<string, AccessRule>;

export function hasAccess(permissions: readonly string[], rule: AccessRule) {
  return rule.permissions.every((permission) => permissions.includes(permission));
}
