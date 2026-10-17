import type { DashboardMetrics } from '../hrHome.types';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export function getTimeOfDay(): TimeOfDay {
  const currentHour = new Date().getHours();

  if (currentHour >= 5 && currentHour < 12) return 'morning';
  if (currentHour >= 12 && currentHour < 18) return 'afternoon';
  return 'evening';
}

export function getFullDate(today: string | null): string {
  if (!today) return '';
  const [year, month, day] = today.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(calendarDate);
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(calendarDate);
  return `${weekday}, ${day} ${monthName} ${year}`;
}

export function formatShortDate(value: string | null): string {
  if (value === null) {
    return 'No date';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function getLocalDateOnly(currentDate = new Date()): Date {
  return new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
  );
}

export function getDaysBetweenDates(fromDate: Date, toDate: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const from = getLocalDateOnly(fromDate).getTime();
  const to = getLocalDateOnly(toDate).getTime();

  return Math.round((to - from) / millisecondsPerDay);
}

export function formatCompactDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(parseDateOnly(value));
}

function calendarDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function formatRelativeDate(value: string, today: string): string {
  const days = calendarDay(value) - calendarDay(today);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days > 1) return `In ${days} days`;
  if (days === -1) return 'Yesterday';
  return `${Math.abs(days)} days ago`;
}

export function formatStartsIn(value: string, today: string): string {
  const days = calendarDay(value) - calendarDay(today);

  if (days === 1) return 'Starts tomorrow';
  if (days > 1) return `Starts in ${days} days`;
  if (days === 0) return 'Starts today';
  return 'Already started';
}

export function areResultsReadyToPublish(metrics: DashboardMetrics): boolean {
  return metrics.completion_rate === 100 && metrics.assignment_count > 0;
}
