import { useSyncExternalStore } from 'react';

// Lets the sidebar show a newly uploaded photo at once, without reloading the signed-in user.
// Keyed by employee so a later sign-in as someone else in the same tab never sees it.
let override: { employeeId: number; value: string | null } | null = null;
const listeners = new Set<() => void>();

export function setProfilePhotoOverride(employeeId: number, value: string | null) {
  override = { employeeId, value };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useProfilePhoto(employeeId: number | null | undefined, fromServer: string | null | undefined) {
  const current = useSyncExternalStore(subscribe, () => override);
  return current && current.employeeId === employeeId ? current.value : fromServer ?? null;
}
