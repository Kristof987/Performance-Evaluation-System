export function getAuthenticatedDashboardPath(permissions: string[]) {
  return permissions.includes('campaigns.read') ? '/hr-home' : '/employee-home';
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
