export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function formatScore(value: number | null) {
  return value === null ? 'Not available' : value.toFixed(2);
}

export function completionText(completed: number, total: number) {
  return `${completed} of ${total} evaluations completed`;
}

export function reportScopeTitle(section: { name: string } | undefined, groups: Array<{ name: string }>, allLabel = 'All groups') {
  return `${section?.name ?? 'All sections'} · ${groups.length ? groups.map((group) => group.name).join(', ') : allLabel}`;
}

/** How the compared cohort is named in labels: groups or company roles. */
export type Noun = { one: string; One: string; many: string; Many: string; all: string };
export const GROUP_NOUN: Noun = { one: 'group', One: 'Group', many: 'groups', Many: 'Groups', all: 'All groups' };
export const ROLE_NOUN: Noun = { one: 'role', One: 'Role', many: 'roles', Many: 'Roles', all: 'All roles' };
