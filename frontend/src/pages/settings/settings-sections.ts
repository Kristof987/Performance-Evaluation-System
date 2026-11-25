import { Bell, Bot, EyeOff, KeyRound, Mail, Palette, ScrollText, ShieldCheck, UserRound, type LucideIcon } from 'lucide-react';

type SettingsSection = 'profile' | 'security' | 'notifications' | 'appearance'
  | 'privacy' | 'emails' | 'ai' | 'permissions' | 'audit';

type Item = { id: SettingsSection; label: string; description: string; icon: LucideIcon; anyOf?: string[] };

export const SETTINGS_GROUPS: { label: string; items: Item[] }[] = [
  { label: 'Your account', items: [
    { id: 'profile', label: 'My profile', description: 'Account details', icon: UserRound },
    { id: 'security', label: 'Security', description: 'Sign-in status', icon: ShieldCheck },
    { id: 'notifications', label: 'Notifications', description: 'Update preferences', icon: Bell },
    { id: 'appearance', label: 'Appearance', description: 'Theme and display', icon: Palette },
  ] },
  { label: 'Workspace', items: [
    { id: 'privacy', label: 'Privacy', description: 'Anonymity thresholds', icon: EyeOff, anyOf: ['workspace.manage'] },
    { id: 'emails', label: 'Email reminders', description: 'Default campaign emails', icon: Mail, anyOf: ['workspace.manage'] },
    { id: 'ai', label: 'AI analysis', description: 'On/off and model', icon: Bot, anyOf: ['workspace.manage'] },
    { id: 'permissions', label: 'Permissions', description: 'What each role can do', icon: KeyRound,
      anyOf: ['permissions.manage', 'workspace.manage'] },
    { id: 'audit', label: 'Audit log', description: 'Who changed what', icon: ScrollText, anyOf: ['audit.read'] },
  ] },
];

export function canOpenSection(section: SettingsSection, permissions: string[]) {
  const item = SETTINGS_GROUPS.flatMap((group) => group.items).find((candidate) => candidate.id === section);
  return !!item && (!item.anyOf || item.anyOf.some((permission) => permissions.includes(permission)));
}

export function isSettingsSection(value: string | undefined): value is SettingsSection {
  return SETTINGS_GROUPS.some((group) => group.items.some((item) => item.id === value));
}
