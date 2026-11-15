import type { Preferences } from './settings.api';

export function formatSettingsDate(value: string | null, timeZone: string, preferences: Preferences) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not available';
  if (preferences.date_format === 'iso') {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
  }
  return new Intl.DateTimeFormat(preferences.language === 'hu' ? 'hu-HU' : 'en-GB', {
    timeZone, dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}
