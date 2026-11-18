import type { DashboardMetrics } from '../hrHome.types';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export function getTimeOfDay(): TimeOfDay {
  const currentHour = new Date().getHours();

  if (currentHour >= 5 && currentHour < 12) return 'morning';
  if (currentHour >= 12 && currentHour < 18) return 'afternoon';
  return 'evening';
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
