import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import ReportsEmptyState from './ReportsEmptyState';

export type ChartSeries = { id: string; label: string; color: string; value: number | null; detail?: string; href?: string };

export function ChartCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="reports-card reports-chart-card"><div className="reports-section-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</section>;
}

export function SeriesBars({ series, maximum = 5, unit = '/ 5', legend = false, empty = 'No reportable results are available for this comparison.' }: { series: ChartSeries[]; maximum?: number; unit?: string; legend?: boolean; empty?: string }) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const active = selected ?? series.slice(0, legend ? 6 : series.length).map((item) => item.id);
  const visible = series.filter((item) => active.includes(item.id) && item.value !== null);
  return <>
    {legend && series.length > 0 && <div className="reports-entity-legend" aria-label="Toggle comparison series">{series.map((item) => <button key={item.id} type="button" aria-pressed={active.includes(item.id)} className={active.includes(item.id) ? '' : 'is-muted'} onClick={() => setSelected(active.includes(item.id) ? active.filter((id) => id !== item.id) : [...active, item.id])}><i style={{ backgroundColor: item.color }} />{item.label}</button>)}</div>}
    {visible.length === 0 ? <ReportsEmptyState title={series.length > 0 && active.length === 0 ? 'All series hidden' : 'No data available'} message={series.length > 0 && active.length === 0 ? 'Select a legend item to show its series.' : empty} /> : <div className="reports-series-list">{visible.map((item) => <div className="reports-series-row" key={item.id}><div className="reports-series-label">{item.href ? <Link to={item.href}>{item.label}</Link> : <strong>{item.label}</strong>}{item.detail && <small>{item.detail}</small>}</div><div className="reports-bar-track" role="img" aria-label={`${item.label}: ${item.value?.toFixed(2)} ${unit}`}><span style={{ width: `${Math.max(0, Math.min(100, (item.value! / maximum) * 100))}%`, backgroundColor: item.color }} /></div><strong>{item.value?.toFixed(unit === '%' ? 0 : 2)}{unit === '%' ? '%' : ` ${unit}`}</strong></div>)}</div>}
  </>;
}
