import type { SidebarPage } from '../pages/layout/Sidebar';

/**
 * Which permissions each area needs. The route guard in main.tsx and the sidebar menu both read
 * this table, so a page and its menu entry can never disagree.
 */
export type AccessRule = { permissions: string[]; feature: string; activePage: SidebarPage; anyOf?: boolean };

export const ACCESS = {
  evaluations: { permissions: ['evaluations.read_assigned'], feature: 'Evaluations', activePage: 'my-evaluations' },
  people: { permissions: ['employees.read', 'groups.read'], feature: 'People', activePage: 'people' },
  campaigns: { permissions: ['campaigns.read'], feature: 'Campaigns', activePage: 'campaigns' },
  completion: { permissions: ['campaigns.read'], feature: 'Completion status', activePage: 'campaigns' },
  forms: { permissions: ['forms.read', 'sections.read'], feature: 'Forms', activePage: 'forms' },
  // Group leaders (reports.read_team) reach Reports too, but only the employee and group views of their teams.
  reports: { permissions: ['reports.read', 'reports.read_team'], feature: 'Reports', activePage: 'reports', anyOf: true },
  campaignReports: { permissions: ['reports.read'], feature: 'Campaign reports', activePage: 'reports' },
  settings: { permissions: ['settings.read'], feature: 'Settings', activePage: 'settings' },
} satisfies Record<string, AccessRule>;

export function hasAccess(permissions: readonly string[], rule: AccessRule) {
  const granted = (permission: string) => permissions.includes(permission);
  return rule.anyOf ? rule.permissions.some(granted) : rule.permissions.every(granted);
}

/** True for group leaders who see only their teams' reports. */
export function hasTeamReportsOnly(permissions: readonly string[]) {
  return !permissions.includes('reports.read') && permissions.includes('reports.read_team');
}
