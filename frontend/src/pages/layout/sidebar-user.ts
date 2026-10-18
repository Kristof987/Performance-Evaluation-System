export type SidebarUser = {
  id: number;
  employee_id: number | null;
  username: string;
  full_name: string | null;
  profile_image_url: string | null;
  role_name: string | null;
};

function normalizeRole(roleName: string | null) {
  return roleName?.trim().toLowerCase() ?? '';
}

export function getSidebarUser(): SidebarUser | null {
  try {
    const stored = sessionStorage.getItem('loggedInUser');
    if (stored === null) return null;
    const user: unknown = JSON.parse(stored);
    if (
      typeof user !== 'object' ||
      user === null ||
      !('username' in user) ||
      typeof user.username !== 'string' ||
      !('id' in user) ||
      typeof user.id !== 'number'
    )
      return null;
    return {
      id: user.id,
      employee_id: 'employee_id' in user && typeof user.employee_id === 'number' ? user.employee_id : null,
      username: user.username,
      full_name: 'full_name' in user && typeof user.full_name === 'string' ? user.full_name : null,
      profile_image_url:
        'profile_image_url' in user &&
        typeof user.profile_image_url === 'string'
          ? user.profile_image_url
          : null,
      role_name:
        'role_name' in user && typeof user.role_name === 'string'
          ? user.role_name
          : null,
    };
  } catch {
    return null;
  }
}

export function isHrOrManagerRole(roleName: string | null) {
  const role = normalizeRole(roleName);
  return role === 'hr' || role === 'manager' || role.includes('manager');
}

export function getDashboardPath() {
  const user = getSidebarUser();
  return isHrOrManagerRole(user?.role_name ?? null) ? '/hr-home' : '/employee-home';
}

export function getAuthenticatedDashboardPath(permissions: string[]) {
  return permissions.includes('campaigns.read') ? '/hr-home' : '/employee-home';
}

export function getUserDisplayName(user: SidebarUser) {
  return user.full_name?.trim() || formatUserName(user.username);
}

export function formatUserName(username: string) {
  return username
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function getUserInitials(name: string) {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'U'
  );
}
