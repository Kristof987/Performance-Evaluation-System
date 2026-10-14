import type { ReportDimensionScore } from '../types/reports.types';
import ReportsEmptyState from './ReportsEmptyState';

export default function PerformanceDimensionsChart({ dimensions }: { dimensions: ReportDimensionScore[] }) {
  if (dimensions.length === 0) {
    return <section className="reports-card reports-chart-card"><div className="reports-section-heading"><h2>Performance by dimension</h2><p>Peer feedback only. Averages require explicit compatible dimension metadata.</p></div><ReportsEmptyState title="No comparable performance dimensions configured." message="Add a performance dimension to compatible scale questions in Forms to enable this chart." /></section>;
  }
  const scaleMax = Math.max(...dimensions.map((dimension) => dimension.scale_max));
  return <section className={dimensions.length <= 1 ? 'reports-card reports-chart-card reports-chart-card-compact' : 'reports-card reports-chart-card'}><div className="reports-section-heading"><h2>Performance by dimension</h2><p>Evaluatee-balanced peer feedback averages. Sample sizes show valid submitted rating responses.</p></div><div className="reports-dimension-chart" role="list">
    {dimensions.map((dimension) => {
      const percent = (dimension.average_score / scaleMax) * 100;
      return <div className="reports-bar-row" key={dimension.id} role="listitem">
        <div className="reports-bar-label"><strong>{dimension.name}</strong><span>{dimension.response_count} responses · {dimension.evaluatee_count} employees · {dimension.scale_min}-{dimension.scale_max} scale{dimension.campaign_average_score ? ` · campaign ${dimension.campaign_average_score.toFixed(2)}` : ''}</span></div>
        <div className="reports-bar-track" aria-label={`${dimension.name} average ${dimension.average_score} out of ${dimension.scale_max}`}><span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div>
        <strong className="reports-bar-value">{dimension.average_score.toFixed(2)}</strong>
      </div>;
    })}
  </div></section>;
}
