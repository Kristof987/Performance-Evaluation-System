import { useState } from 'react';
import { Link } from 'react-router';
import type { ChartSeries } from './ReportCharts';

const label = (value: string, length = 19) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const employeeLabel = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${label(parts[0], 8)} ${parts[parts.length - 1][0]}.` : label(name, 11);
};

function useVisible(series: ChartSeries[], legend: boolean) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const active = selection ?? series.slice(0, legend ? 5 : series.length).map((item) => item.id);
  return { active, visible: series.filter((item) => active.includes(item.id) && item.value !== null), setSelection };
}

function EntityLegend({ series, active, onToggle }: { series: ChartSeries[]; active: string[]; onToggle: (ids: string[]) => void }) {
  return <div className="reports-entity-legend" aria-label="Toggle chart series">{series.map((item) => <button type="button" key={item.id} aria-pressed={active.includes(item.id)} className={active.includes(item.id) ? '' : 'is-muted'} onClick={() => onToggle(active.includes(item.id) ? active.filter((id) => id !== item.id) : [...active, item.id])}><i style={{ backgroundColor: item.color }} />{item.label}</button>)}</div>;
}

function ChartNotice({ children }: { children: string }) {
  return <p className="reports-chart-notice">{children}</p>;
}

export function HorizontalChart({ series, maximum = 5, unit = '/ 5', legend = false, relaxed = false, multiline = false, axisLabel }: { series: ChartSeries[]; maximum?: number; unit?: string; legend?: boolean; relaxed?: boolean; multiline?: boolean; axisLabel?: string }) {
  const { active, visible, setSelection } = useVisible(series, legend);
  const width = 520;
  const top = 18;
  const left = multiline ? 246 : 146;
  const plotWidth = multiline ? 220 : 320;
  const rowHeight = multiline ? 58 : relaxed ? 51 : 37;
  const height = top + visible.length * rowHeight + (axisLabel ? 46 : 30);
  return <>
    {legend && <EntityLegend series={series} active={active} onToggle={setSelection} />}
    {!visible.length ? <ChartNotice>{active.length ? 'No reportable ratings for this selection.' : 'Select a legend item to show its result.'}</ChartNotice> : <div className="reports-svg-wrap"><svg className="reports-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Ratings on a ${unit === '%' ? '0 to 100 percent' : '0 to 5'} axis`}>
      {[0, 1, 2, 3, 4, 5].map((tick) => { const x = left + tick * plotWidth / 5; return <g key={tick}><line className="reports-svg-grid" x1={x} x2={x} y1={top - 7} y2={height - (axisLabel ? 41 : 25)} /><text className="reports-svg-axis" x={x} y={height - (axisLabel ? 24 : 6)} textAnchor="middle">{unit === '%' ? tick * 20 : tick}</text></g>; })}
      {visible.map((item, index) => { const y = top + index * rowHeight + (relaxed ? 6 : 0); const words = item.label.split(/\s+/); const lines: string[] = []; if (multiline) { for (const word of words) { const last = lines.length - 1; if (last >= 0 && `${lines[last]} ${word}`.length <= 36) lines[last] += ` ${word}`; else lines.push(word); } } const content = <><title>{`${item.label}: ${item.value?.toFixed(unit === '%' ? 0 : 2)} ${unit}${item.detail ? ` · ${item.detail}` : ''}`}</title><text className="reports-svg-label" x={left - 10} y={y + (multiline ? 4 : 14)} textAnchor="end">{multiline ? lines.slice(0, 2).map((line, lineIndex) => <tspan key={lineIndex} x={left - 10} dy={lineIndex ? 13 : 0}>{lineIndex === 1 && lines.length > 2 ? label(lines.slice(1).join(' '), 36) : line}</tspan>) : label(item.label)}</text><rect x={left} y={y + 1} width={plotWidth} height={15} rx={4} fill="#f0f3f8" /><rect x={left} y={y + 1} width={Math.max(0, Math.min(plotWidth, item.value! / maximum * plotWidth))} height={15} rx={4} fill={item.color} /><text className="reports-svg-value" x={left + plotWidth + 8} y={y + 14}>{item.value?.toFixed(unit === '%' ? 0 : 2)}{unit === '%' ? '%' : ''}</text></>; return item.href ? <Link to={item.href} aria-label={`${item.label}: ${item.value?.toFixed(2)} ${unit}`} className="reports-svg-link" key={item.id}>{content}</Link> : <g key={item.id}>{content}</g>; })}
      {axisLabel && <text className="reports-svg-axis" x={left + plotWidth / 2} y={height - 5} textAnchor="middle">{axisLabel}</text>}
    </svg></div>}
  </>;
}

export function Histogram({ buckets, compact = false }: { buckets: Array<{ label: string; count: number; percentage: number }>; compact?: boolean }) {
  const width = 520;
  const left = 72;
  const bottom = compact ? 155 : 183;
  const visible = buckets.filter((bucket) => bucket.label !== '0-<1');
  const plotWidth = width - left - 14;
  const step = plotWidth / Math.max(1, visible.length);
  return <div className="reports-svg-wrap"><svg className="reports-svg" viewBox={`0 0 520 ${compact ? 207 : 237}`} role="img" aria-label="Share of peer ratings by rating interval">
    {[0, 1, 2, 3, 4].map((tick) => { const y = bottom - tick * 35; return <g key={tick}><line className="reports-svg-grid" x1={left} x2={width - 12} y1={y} y2={y} /><text className="reports-svg-axis" x={left - 8} y={y + 4} textAnchor="end">{tick * 25}%</text></g>; })}
    {visible.map((bucket, index) => { const barHeight = bucket.percentage / 100 * 140; const x = left + index * step + step * .16; const interval = bucket.label.replace('-<', '–').replace('-', '–'); return <g key={bucket.label}><title>{`${interval}: ${bucket.count} peer ratings (${bucket.percentage}%)`}</title><rect x={x} y={bottom - barHeight} width={step * .68} height={barHeight} rx={3} fill={index % 2 ? '#8061cb' : '#3468cc'} /><text className="reports-svg-axis" x={x + step * .34} y={bottom + 17} textAnchor="middle">{interval}</text></g>; })}
    <text className="reports-svg-axis" x={width / 2 + 30} y={compact ? 195 : 225} textAnchor="middle">Rating (1–5)</text>
    <text className="reports-svg-axis" transform={`translate(14 ${compact ? 96 : 112}) rotate(-90)`} textAnchor="middle">Share of ratings (%)</text>
  </svg></div>;
}

export function ComparisonChart({ series, employeesPath }: { series: ChartSeries[]; employeesPath: string }) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'highest' | 'lowest' | 'name'>('highest');
  const ordered = [...series].sort((a, b) => sort === 'name' ? a.label.localeCompare(b.label) : sort === 'lowest' ? a.value! - b.value! || a.label.localeCompare(b.label) : b.value! - a.value! || a.label.localeCompare(b.label));
  const active = selection ?? [...series].sort((a, b) => b.value! - a.value! || a.label.localeCompare(b.label)).slice(0, 6).map((item) => item.id);
  const chosen = ordered.filter((item) => active.includes(item.id) && item.value !== null);
  const legendSeries = ordered.filter((item) => item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const width = Math.max(520, 70 * chosen.length + 70);
  const left = 42;
  const bottom = 190;
  const plotWidth = width - left - 14;
  const step = plotWidth / Math.max(1, chosen.length);
  return <><div className="reports-comparison-controls"><input className="form-control" type="search" aria-label="Search employee legend" placeholder="Find employee" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="form-control" aria-label="Sort employee comparison" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="highest">Highest rating</option><option value="lowest">Lowest rating</option><option value="name">Name A–Z</option></select></div><EntityLegend series={legendSeries} active={active} onToggle={setSelection} />{search && legendSeries.length === 0 && <p className="reports-chart-notice">No matching employees. Selected bars remain visible.</p>}{!chosen.length ? <ChartNotice>{active.length ? 'No reportable employee ratings for this selection.' : 'Select employees in the legend to compare them.'}</ChartNotice> : <div className="reports-svg-wrap reports-comparison-scroll" tabIndex={0} aria-label="Scroll employee rating chart horizontally"><svg className="reports-svg" viewBox={`0 0 ${width} 226`} style={{ width: chosen.length > 6 ? `${width}px` : '100%' }} role="img" aria-label="Reportable peer ratings by employee, normalized to five">
    {[0, 1, 2, 3, 4, 5].map((tick) => { const y = bottom - tick * 30; return <g key={tick}><line className="reports-svg-grid" x1={left} x2={width - 14} y1={y} y2={y} /><text className="reports-svg-axis" x={left - 8} y={y + 4} textAnchor="end">{tick}</text></g>; })}
    {chosen.map((item, index) => { const x = left + index * step + step * .23; const barHeight = item.value! / 5 * 150; const short = employeeLabel(item.label); const duplicate = chosen.some((other) => other.id !== item.id && employeeLabel(other.label) === short); return <Link to={item.href!} aria-label={`${item.label}: ${item.value?.toFixed(2)} out of 5. View employee report.`} className="reports-svg-link" key={item.id}><title>{`${item.label}: ${item.value?.toFixed(2)} / 5`}</title><rect x={x} y={bottom - barHeight} width={step * .54} height={barHeight} rx={4} fill={item.color} /><text className="reports-svg-value" x={x + step * .27} y={bottom - barHeight - 6} textAnchor="middle">{item.value?.toFixed(2)}</text><text className="reports-svg-axis" x={x + step * .27} y={bottom + 18} textAnchor="middle">{duplicate ? label(item.label, 11) : short}</text></Link>; })}
    <text className="reports-svg-axis" x={width / 2} y={222} textAnchor="middle">Employees · peer rating / 5</text>
  </svg></div>}<div className="reports-comparison-footer"><Link to={employeesPath}>All employees</Link></div></>;
}
