import { useEffect, useState } from 'react';

// SVG attributes cannot resolve var(), so charts read the theme tokens once per theme change.
const TOKENS = {
  low: '--chart-score-low',
  mid: '--chart-score-mid',
  high: '--chart-score-high',
  grid: '--chart-grid',
  axis: '--chart-axis',
  text: '--color-text',
  textSecondary: '--color-text-secondary',
  textMuted: '--color-text-muted',
  surface: '--color-surface',
  surfaceMuted: '--color-surface-muted',
  primary: '--color-primary',
} as const;

export const SERIES_COUNT = 8;

export type ChartTheme = Record<keyof typeof TOKENS, string> & { series: string[]; dark: boolean };

function readTheme(): ChartTheme {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const values = Object.fromEntries(Object.entries(TOKENS).map(([key, name]) => [key, read(name)])) as Record<keyof typeof TOKENS, string>;
  return {
    ...values,
    series: Array.from({ length: SERIES_COUNT }, (_, index) => read(`--chart-series-${index + 1}`)),
    dark: document.documentElement.dataset.theme === 'dark',
  };
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((part) => part + part).join('') : value;
  const number = Number.parseInt(full, 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function mix(from: string, to: string, amount: number) {
  const a = rgb(from);
  const b = rgb(to);
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount).toString(16).padStart(2, '0')).join('')}`;
}

/** 1–5 score → low (≤2) · mid (3) · high (≥4.5). */
export function scoreColor(theme: ChartTheme, score: number) {
  const clamped = Math.min(Math.max(score, 2), 4.5);
  return clamped <= 3 ? mix(theme.low, theme.mid, clamped - 2) : mix(theme.mid, theme.high, (clamped - 3) / 1.5);
}

/** Readable ink on a score-colored fill: dark text on the light cells of the dark theme, white otherwise. */
export function scoreInk(theme: ChartTheme) {
  return theme.dark ? '#101522' : '#ffffff';
}

/** Group colors follow the group's position in the campaign, never its rank or the current selection. */
export function seriesColor(theme: ChartTheme, index: number) {
  return theme.series[index % SERIES_COUNT];
}

export function formatDelta(current: number | null, previous: number | null, digits = 2) {
  if (current === null || previous === null) return null;
  const delta = current - previous;
  const rounded = Number(delta.toFixed(digits));
  return { value: rounded, label: `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(digits)}` };
}
