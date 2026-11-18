import { useMemo } from 'react';
import { useAppAuth } from '../auth/AppAuth';
import { usePreferences } from '../pages/settings/preferences-context';

/**
 * One place for showing dates.
 * - Calendar days ("2026-11-18", due dates) never shift: they are shown as that day everywhere.
 * - Moments (timestamps) are shown in the business time zone from the server, not the browser's,
 *   so everyone sees the same day and hour for the same event.
 * - The user's date format (locale or ISO) and language preferences apply everywhere.
 */

export const DEFAULT_TIME_ZONE = 'Europe/Budapest';

export type DateSettings = { timeZone: string; iso: boolean; language: 'en' | 'hu' };

export const defaultDateSettings: DateSettings = { timeZone: DEFAULT_TIME_ZONE, iso: false, language: 'en' };

type DayOptions = { year?: boolean; weekday?: boolean; month?: 'short' | 'long' };

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = locale + JSON.stringify(options);
  let item = formatters.get(key);
  if (!item) { item = new Intl.DateTimeFormat(locale, options); formatters.set(key, item); }
  return item;
}

const localeOf = (settings: DateSettings) => settings.language === 'hu' ? 'hu-HU' : 'en-GB';

function parts(date: Date, timeZone: string) {
  const values = formatter('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => values.find((item) => item.type === type)?.value ?? '';
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') };
}

/** The calendar day ("YYYY-MM-DD") a value falls on in the business time zone. */
export function calendarDay(value: string | Date, settings: DateSettings = defaultDateSettings): string | null {
  if (typeof value === 'string' && DAY_ONLY.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const { year, month, day } = parts(date, settings.timeZone);
  return `${year}-${month}-${day}`;
}

/** Today in the business time zone. */
export function businessToday(settings: DateSettings = defaultDateSettings): string {
  return calendarDay(new Date(), settings) ?? new Date().toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const toUtc = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** A calendar day: "18 Nov 2026", or "2026-11-18" with the ISO preference. Timestamps become their business day. */
export function formatDay(value: string | null | undefined, settings: DateSettings = defaultDateSettings,
  { year = true, weekday = false, month = 'short' }: DayOptions = {}, empty = '—'): string {
  if (!value) return empty;
  const day = calendarDay(value, settings);
  if (!day) return empty;
  if (settings.iso) return year ? day : day.slice(5);
  const [y, m, d] = day.split('-').map(Number);
  // Noon UTC formatted in UTC: the shown day can't move whatever the browser's time zone is.
  return formatter(localeOf(settings), {
    timeZone: 'UTC', day: 'numeric', month, ...(year ? { year: 'numeric' } : {}), ...(weekday ? { weekday: 'long' } : {}),
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** A moment: "18 Nov 2026, 21:05" in the business time zone, or "2026-11-18 21:05" with the ISO preference. */
export function formatDateTime(value: string | null | undefined, settings: DateSettings = defaultDateSettings, empty = '—'): string {
  if (!value) return empty;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return empty;
  if (settings.iso) {
    const { year, month, day, hour, minute } = parts(date, settings.timeZone);
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
  return formatter(localeOf(settings), {
    timeZone: settings.timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);
}

/** The current user's date settings: business time zone plus their format and language preferences. */
export function useDateSettings(): DateSettings {
  const { state } = useAppAuth();
  const { preferences } = usePreferences();
  const timeZone = state.status === 'authenticated' ? state.user.timezone ?? DEFAULT_TIME_ZONE : DEFAULT_TIME_ZONE;
  return useMemo(() => ({
    timeZone, iso: preferences.date_format === 'iso', language: preferences.language === 'hu' ? 'hu' : 'en',
  }), [timeZone, preferences.date_format, preferences.language]);
}

/** Formatting functions bound to the current user's settings. */
export function useDates() {
  const settings = useDateSettings();
  return useMemo(() => ({
    settings,
    day: (value: string | null | undefined, options?: DayOptions, empty?: string) => formatDay(value, settings, options, empty),
    dateTime: (value: string | null | undefined, empty?: string) => formatDateTime(value, settings, empty),
    today: () => businessToday(settings),
  }), [settings]);
}

/** Short place name of the business time zone for labels: "Europe/Budapest" → "Budapest". */
export function zoneLabel(settings: DateSettings): string {
  return (settings.timeZone.split('/').pop() ?? settings.timeZone).replace(/_/g, ' ');
}

/** Month abbreviation of a calendar day ("NOV", or "11" with the ISO preference), for date badges. */
export function monthLabel(day: string, settings: DateSettings = defaultDateSettings): string {
  const value = calendarDay(day, settings);
  if (!value) return '';
  if (settings.iso) return value.slice(5, 7);
  const [y, m, d] = value.split('-').map(Number);
  return formatter(localeOf(settings), { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(y, m - 1, d, 12))).replace('.', '').toUpperCase();
}
