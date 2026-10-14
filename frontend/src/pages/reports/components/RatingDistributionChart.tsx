import type { ReportRatingDistributionSource } from '../types/reports.types';
import { selectedDistributionSource } from '../reports.utils';
import ReportsEmptyState from './ReportsEmptyState';

export default function RatingDistributionChart({ sources, selectedId, onSelect }: { sources: ReportRatingDistributionSource[]; selectedId: string; onSelect: (id: string) => void }) {
  const source = selectedDistributionSource(sources, selectedId);
  if (source === null) {
    return <section className="reports-card reports-chart-card"><div className="reports-section-heading"><h2>Rating distribution</h2><p>Submitted peer rating responses from a selected compatible source.</p></div><ReportsEmptyState title="No numerical rating data available." message="Submitted compatible peer rating responses are required before a distribution can be shown." /></section>;
  }
  const maxCount = Math.max(1, ...source.buckets.map((bucket) => bucket.count));
  return <section className="reports-card reports-chart-card compact"><div className="reports-section-heading reports-section-heading-row"><div><h2>Rating distribution</h2><p>{source.response_count} responses · {source.scale_min}-{source.scale_max} scale</p></div><select className="form-control reports-source-select" value={source.id} onChange={(event) => onSelect(event.target.value)} aria-label="Rating distribution source">{sources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div><div className="reports-distribution-chart" aria-label={`Rating distribution for ${source.label}`}>
    {source.buckets.map((bucket) => <div className="reports-distribution-column" key={bucket.rating} title={`${bucket.count} responses for rating ${bucket.rating}`}><div className="reports-distribution-bar"><span style={{ height: `${(bucket.count / maxCount) * 100}%` }} /></div><strong>{bucket.rating}</strong><small>{bucket.count}</small></div>)}
  </div></section>;
}
