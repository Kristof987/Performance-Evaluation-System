type SidebarUser = { username: string; profile_image_url: string | null };
export function getSidebarUser(): SidebarUser | null {
  try {
    const stored = sessionStorage.getItem('loggedInUser');
    if (stored === null) return null;
    const user: unknown = JSON.parse(stored);
    if (
      typeof user !== 'object' ||
      user === null ||
      !('username' in user) ||
      typeof user.username !== 'string'
    )
      return null;
    return {
      username: user.username,
      profile_image_url:
        'profile_image_url' in user &&
        typeof user.profile_image_url === 'string'
          ? user.profile_image_url
          : null,
    };
  } catch {
    return null;
  }
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
