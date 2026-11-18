import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDelta, scoreColor, scoreInk, type ChartTheme } from './chartTheme';

const SCORE_DOMAIN: [number, number] = [1, 5];
const SCORE_TICKS = [1, 2, 3, 4, 5];
const score = (value: number | null | undefined) => value === null || value === undefined ? '–' : value.toFixed(2);
const shorten = (value: string, length = 18) => value.length > length ? `${value.slice(0, length - 1)}…` : value;

export function Delta({ current, previous, digits = 2, unit = '', label }: { current: number | null; previous: number | null; digits?: number; unit?: string; label?: string }) {
  const delta = formatDelta(current, previous, digits);
  if (!delta) return null;
  const tone = delta.value > 0 ? 'up' : delta.value < 0 ? 'down' : 'flat';
  const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : Minus;
  return <span className={`reports-delta is-${tone}`} title={label ? `${delta.label}${unit} ${label}` : undefined}><Icon size={13} aria-hidden="true" />{delta.label}{unit}{label && <span className="reports-sr-only"> {label}</span>}</span>;
}

type TooltipRow = { name: string; value: string; color?: string };

function TooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return <div className="reports-chart-tooltip"><strong>{title}</strong>{rows.map((row) => <span key={row.name}>{row.color && <i style={{ background: row.color }} aria-hidden="true" />}{row.name}<b>{row.value}</b></span>)}</div>;
}

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ name?: unknown; value?: unknown; color?: string; payload?: Record<string, unknown> }>; label?: unknown };

function seriesTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const title = String(payload[0].payload?.fullName ?? label ?? '');
  return <TooltipCard title={title} rows={payload.filter((item) => typeof item.value === 'number').map((item) => ({ name: String(item.name ?? ''), value: (item.value as number).toFixed(2), color: item.color }))} />;
}

function axisProps(theme: ChartTheme) {
  return { stroke: theme.axis, tick: { fill: theme.textSecondary, fontSize: 11 }, tickLine: false };
}

export type ScoreBarRow = { id: number; name: string; score: number | null; previous?: number | null; muted?: boolean };

/** Horizontal score bars; the bar colour follows the score, the dashed line marks the reference. */
export function ScoreBars({ theme, rows, reference, referenceLabel, onSelect }: { theme: ChartTheme; rows: ScoreBarRow[]; reference?: number | null; referenceLabel?: string; onSelect?: (id: number) => void }) {
  const data = rows.filter((row) => row.score !== null).map((row) => ({ ...row, label: shorten(row.name), fullName: row.name }));
  const tip = ({ active, payload }: TooltipProps) => {
    const row = payload?.[0]?.payload as (ScoreBarRow & { fullName: string }) | undefined;
    if (!active || !row) return null;
    return <TooltipCard title={row.fullName} rows={[{ name: 'Peer rating', value: score(row.score), color: scoreColor(theme, row.score ?? 1) }, ...(row.previous != null ? [{ name: 'Previous campaign', value: score(row.previous) }] : []), ...(reference != null ? [{ name: referenceLabel ?? 'Reference', value: score(reference) }] : [])]} />;
  };
  return <ResponsiveContainer width="100%" height={Math.max(150, data.length * 40 + 44)}>
    <BarChart data={data} layout="vertical" margin={{ top: 6, right: 40, bottom: 4, left: 4 }} barCategoryGap="28%">
      <CartesianGrid horizontal={false} stroke={theme.grid} />
      <XAxis type="number" domain={SCORE_DOMAIN} ticks={SCORE_TICKS} {...axisProps(theme)} />
      <YAxis type="category" dataKey="label" width={118} {...axisProps(theme)} />
      <Tooltip content={tip} cursor={{ fill: theme.surfaceMuted, opacity: 0.6 }} />
      {reference != null && <ReferenceLine x={reference} stroke={theme.textMuted} strokeDasharray="4 4" ifOverflow="extendDomain" />}
      <Bar dataKey="score" name="Peer rating" radius={[0, 4, 4, 0]} cursor={onSelect ? 'pointer' : undefined} onClick={(entry) => onSelect?.((entry as unknown as ScoreBarRow).id)} isAnimationActive={false}>
        {data.map((row) => <Cell key={row.id} fill={scoreColor(theme, row.score ?? 1)} fillOpacity={row.muted ? 0.35 : 1} />)}
        <LabelList dataKey="score" position="right" formatter={(value) => typeof value === 'number' ? value.toFixed(2) : ''} fill={theme.textSecondary} fontSize={11} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
}

export type ComparedSeries = { id: number; name: string; color: string; values: Record<string, number | null> };

/** One bar per compared group in each category; group colours come from the group, not its rank. */
export function GroupedBars({ theme, categories, series, reference }: { theme: ChartTheme; categories: Array<{ id: number; name: string }>; series: ComparedSeries[]; reference?: number | null }) {
  const data = categories.map((category) => ({ label: shorten(category.name, 16), fullName: category.name, ...Object.fromEntries(series.map((item) => [`g${item.id}`, item.values[String(category.id)] ?? null])) }));
  return <ResponsiveContainer width="100%" height={280}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }} barGap={2} barCategoryGap="22%">
      <CartesianGrid vertical={false} stroke={theme.grid} />
      <XAxis dataKey="label" interval={0} {...axisProps(theme)} />
      <YAxis domain={SCORE_DOMAIN} ticks={SCORE_TICKS} {...axisProps(theme)} />
      <Tooltip content={seriesTooltip} cursor={{ fill: theme.surfaceMuted, opacity: 0.6 }} />
      {reference != null && <ReferenceLine y={reference} stroke={theme.textMuted} strokeDasharray="4 4" />}
      {series.map((item) => <Bar key={item.id} dataKey={`g${item.id}`} name={item.name} fill={item.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />)}
      <Legend iconType="circle" iconSize={9} itemSorter={null} formatter={(value) => <span style={{ color: theme.textSecondary }}>{value}</span>} wrapperStyle={{ fontSize: 12 }} />
    </BarChart>
  </ResponsiveContainer>;
}

export type HeatmapRow = { id: number; name: string; color?: string; cells: Record<string, { score: number | null; availability: string }>; emphasis?: boolean };

/** Groups × sections; hatched cells were withheld by the privacy threshold. */
export function Heatmap({ theme, sections, rows, onCell }: { theme: ChartTheme; sections: Array<{ id: number; name: string }>; rows: HeatmapRow[]; onCell?: (sectionId: number) => void }) {
  const ink = scoreInk(theme);
  return <div className="reports-heatmap-wrap"><table className="reports-heatmap">
    <thead><tr><th scope="col"><span className="reports-sr-only">Group</span></th>{sections.map((section) => <th key={section.id} scope="col" title={section.name}>{shorten(section.name, 16)}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className={row.emphasis ? 'is-emphasis' : undefined}>
      <th scope="row" title={row.name}>{row.color && <i style={{ background: row.color }} aria-hidden="true" />}{row.name}</th>
      {sections.map((section) => {
        const cell = row.cells[String(section.id)];
        const value = cell?.availability === 'available' ? cell.score : null;
        const label = value !== null ? value.toFixed(1) : cell?.availability === 'suppressed' ? 'Hidden' : '–';
        const title = `${row.name} · ${section.name}: ${value !== null ? value.toFixed(2) : cell?.availability === 'suppressed' ? 'hidden by the privacy threshold' : 'no ratings'}`;
        const content = <span className={value === null ? `reports-heat-empty${cell?.availability === 'suppressed' ? ' is-hidden' : ''}` : 'reports-heat-value'} style={value !== null ? { background: scoreColor(theme, value), color: ink } : undefined}>{label}</span>;
        return <td key={section.id} title={title}>{onCell && value !== null ? <button type="button" aria-label={title} onClick={() => onCell(section.id)}>{content}</button> : content}</td>;
      })}
    </tr>)}</tbody>
  </table>
  <div className="reports-heat-legend" aria-hidden="true"><span>1</span><i style={{ background: `linear-gradient(90deg, ${scoreColor(theme, 2)}, ${scoreColor(theme, 3)}, ${scoreColor(theme, 4.5)})` }} /><span>5</span><span className="reports-heat-legend-hidden">Hidden</span></div>
  </div>;
}

export function CompletionDonut({ theme, completed, total }: { theme: ChartTheme; completed: number; total: number }) {
  const rate = total ? Math.round((completed / total) * 100) : 0;
  const data = [{ name: 'Completed', value: completed }, { name: 'Open', value: Math.max(total - completed, 0) }];
  return <div className="reports-donut" role="img" aria-label={`${completed} of ${total} evaluations completed (${rate}%)`}>
    <ResponsiveContainer width="100%" height={150}>
      <PieChart>
        <Pie data={data} dataKey="value" innerRadius={50} outerRadius={68} startAngle={90} endAngle={-270} stroke={theme.surface} strokeWidth={2} isAnimationActive={false}>
          <Cell fill={theme.primary} /><Cell fill={theme.surfaceMuted} />
        </Pie>
      </PieChart>
    </ResponsiveContainer>
    <div className="reports-donut-label"><strong>{rate}%</strong><span>{completed} / {total}</span></div>
  </div>;
}

export function MeterRows({ rows }: { rows: Array<{ id: number; name: string; value: number | null; detail: string; color: string }> }) {
  return <ul className="reports-meter-rows">{rows.map((row) => <li key={row.id}>
    <span className="reports-meter-name" title={row.name}><i style={{ background: row.color }} aria-hidden="true" />{row.name}</span>
    <span className="reports-meter-track" title={row.detail}><span style={{ width: `${row.value ?? 0}%`, background: row.color }} /></span>
    <span className="reports-meter-value">{row.value === null ? '–' : `${row.value}%`}</span>
  </li>)}</ul>;
}

const BIN_SCORES = [1.5, 2.5, 3.5, 4.5];

export function DistributionBars({ theme, bins: raw }: { theme: ChartTheme; bins: Array<{ label: string; count: number; percentage: number }> }) {
  // Ratings are normalized to 1–5, so the 0–1 bucket is always empty.
  const bins = raw.filter((bin) => bin.label !== '0-<1').map((bin) => ({ ...bin, label: bin.label.replace('-<', '–').replace('-', '–') }));
  const tip = ({ active, payload }: TooltipProps) => {
    const bin = payload?.[0]?.payload as { label: string; count: number; percentage: number } | undefined;
    return active && bin ? <TooltipCard title={`Rating ${bin.label}`} rows={[{ name: 'Answers', value: `${bin.count} (${bin.percentage}%)` }]} /> : null;
  };
  return <ResponsiveContainer width="100%" height={200}>
    <BarChart data={bins} margin={{ top: 18, right: 8, bottom: 4, left: -18 }} barCategoryGap="18%">
      <CartesianGrid vertical={false} stroke={theme.grid} />
      <XAxis dataKey="label" {...axisProps(theme)} />
      <YAxis unit="%" allowDecimals={false} {...axisProps(theme)} />
      <Tooltip content={tip} cursor={{ fill: theme.surfaceMuted, opacity: 0.6 }} />
      <Bar dataKey="percentage" name="Share" radius={[4, 4, 0, 0]} isAnimationActive={false}>
        {bins.map((bin, index) => <Cell key={bin.label} fill={scoreColor(theme, BIN_SCORES[index] ?? 3)} />)}
        <LabelList dataKey="percentage" position="top" formatter={(value) => `${value}%`} fill={theme.textSecondary} fontSize={11} />
      </Bar>
    </BarChart>
  </ResponsiveContainer>;
}

export type TrendSeries = { key: string; name: string; color: string; dashed?: boolean };

export function TrendLines({ theme, points: raw, series }: { theme: ChartTheme; points: Array<Record<string, string | number | null>>; series: TrendSeries[] }) {
  // Campaigns without any released score for these series add nothing but an empty slot.
  const points = raw.filter((point) => series.some((item) => typeof point[item.key] === 'number'));
  const values = points.flatMap((point) => series.map((item) => point[item.key])).filter((value): value is number => typeof value === 'number');
  const low = values.length ? Math.max(1, Math.floor((Math.min(...values) - 0.25) * 2) / 2) : 1;
  const high = values.length ? Math.min(5, Math.ceil((Math.max(...values) + 0.25) * 2) / 2) : 5;
  return <ResponsiveContainer width="100%" height={240}>
    <LineChart data={points} margin={{ top: 10, right: 16, bottom: 4, left: -12 }}>
      <CartesianGrid vertical={false} stroke={theme.grid} />
      <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={12} padding={{ left: 36, right: 36 }} {...axisProps(theme)} />
      <YAxis domain={[low, high]} ticks={Array.from({ length: Math.round((high - low) * 2) + 1 }, (_, index) => low + index * 0.5)} width={44} tickFormatter={(value: number) => value.toFixed(1)} {...axisProps(theme)} />
      <Tooltip content={seriesTooltip} />
      {series.map((item) => <Line key={item.key} dataKey={item.key} name={item.name} stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed ? '5 4' : undefined} dot={{ r: 4, strokeWidth: 2, fill: theme.surface }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />)}
      {series.length > 1 && <Legend iconType="plainline" iconSize={14} itemSorter={null} formatter={(value) => <span style={{ color: theme.textSecondary }}>{value}</span>} wrapperStyle={{ fontSize: 12 }} />}
    </LineChart>
  </ResponsiveContainer>;
}

export function ChartCard({ title, subtitle, actions, className = '', children }: { title: string; subtitle?: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`reports-card reports-viz-card ${className}`}>
    <header className="reports-viz-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{actions}</header>
    {children}
  </section>;
}
