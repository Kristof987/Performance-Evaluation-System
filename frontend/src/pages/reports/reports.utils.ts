export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

export function formatScore(value: number | null) {
  return value === null ? 'Not available' : value.toFixed(2);
}

export function completionText(completed: number, total: number) {
  return `${completed} of ${total} evaluations completed`;
}
