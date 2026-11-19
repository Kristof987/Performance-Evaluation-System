export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Spreadsheet apps run cells that start with these characters as formulas.
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: CsvValue[][]) {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function csvScore(value: number | null | undefined, availability?: string) {
  if (availability === 'suppressed') return 'Hidden';
  return value === null || value === undefined ? '' : value.toFixed(2);
}

export function downloadCsv(name: string, rows: CsvValue[][]) {
  // The byte order mark makes Excel read the file as UTF-8, so accented names survive.
  const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'report'}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
