import type { ReportKpiSummary } from '../types/reports.types';
import { formatScore } from '../reports.utils';
import { Info } from 'lucide-react';

export default function ReportsKpiPanel({ kpis }: { kpis: ReportKpiSummary }) {
  return <section className="reports-kpi-panel" aria-label="Campaign report metrics">
    <div className="reports-kpi-segment reports-kpi-primary"><span>Completion</span><strong>{kpis.completed_evaluations} / {kpis.total_evaluations}</strong><small>{`${kpis.completion_rate}% complete`}</small></div>
    <div className="reports-kpi-segment"><span>Employees Evaluated</span><strong>{kpis.employees_evaluated}</strong><small>With completed peer feedback</small></div>
    <div className="reports-kpi-segment"><span className="reports-kpi-heading">Average Peer Rating <span className="reports-info-icon" tabIndex={0} title={`${kpis.overall_score_context}${kpis.overall_score_scale ? ` · ${kpis.overall_score_scale} scale` : ''}`} aria-label={`${kpis.overall_score_context}${kpis.overall_score_scale ? ` · ${kpis.overall_score_scale} scale` : ''}`}><Info size={13} /></span></span><strong>{kpis.overall_availability === 'suppressed' ? 'Suppressed' : formatScore(kpis.overall_score)}</strong><small>Normalized section score / 5</small></div>
  </section>;
}
