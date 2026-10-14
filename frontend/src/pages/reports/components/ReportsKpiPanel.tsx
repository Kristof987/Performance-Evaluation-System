import type { ReportKpiSummary } from '../types/reports.types';
import { formatPercent, formatScore } from '../reports.utils';

export default function ReportsKpiPanel({ kpis }: { kpis: ReportKpiSummary }) {
  return <section className="reports-kpi-panel" aria-label="Campaign report metrics">
    <div className="reports-kpi-segment reports-kpi-primary"><span>Completion rate</span><strong>{formatPercent(kpis.completion_rate)}</strong><small>{`${kpis.completed_evaluations} of ${kpis.total_evaluations} completed`}</small></div>
    <div className="reports-kpi-segment"><span>Overall score</span><strong>{formatScore(kpis.overall_score)}</strong><small>{kpis.overall_score_scale ? `${kpis.overall_score_context} · ${kpis.overall_score_scale} scale` : kpis.overall_score_context}</small></div>
    <div className="reports-kpi-segment"><span>Employees evaluated</span><strong>{kpis.employees_evaluated}</strong><small>Employees with completed peer feedback</small></div>
    <div className="reports-kpi-segment"><span>Submitted evaluations</span><strong>{kpis.submitted_evaluations}</strong><small>Submitted review forms</small></div>
  </section>;
}
