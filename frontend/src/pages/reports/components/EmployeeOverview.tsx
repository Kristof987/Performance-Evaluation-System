import type { EmployeeReportsOverview } from '../types/reports.types';

export default function EmployeeOverview({ report }: { report: EmployeeReportsOverview }) {
  const { kpis } = report;
  const scores = report.employees.map((employee) => employee.performance_summary.availability === 'available' ? employee.performance_summary.overall_peer_score : null).filter((value): value is number => value !== null);
  const improved = report.employees.filter((employee) => {
    const { overall_peer_score: score, previous_overall_peer_score: previous, availability } = employee.performance_summary;
    return availability === 'available' && score !== null && previous !== null && score - previous > 0.05;
  }).length;
  const compared = report.employees.filter((employee) => employee.performance_summary.availability === 'available' && employee.performance_summary.previous_overall_peer_score !== null).length;
  return <section className="reports-kpi-row" aria-label="Employee reporting summary">
    <div className="reports-kpi-card"><span>Participating employees</span><strong>{kpis.participating_employees}</strong><small>{kpis.employees_with_peer_feedback} with peer feedback{kpis.awaiting_peer_feedback ? ` · ${kpis.awaiting_peer_feedback} awaiting` : ''}</small></div>
    <div className="reports-kpi-card"><span>Peer reviews completed</span><strong>{kpis.peer_reviews_completed} / {kpis.peer_reviews_assigned}</strong><small>Submitted of assigned peer reviews</small></div>
    <div className="reports-kpi-card"><span>Peer rating range</span><strong>{scores.length ? `${Math.min(...scores).toFixed(2)} – ${Math.max(...scores).toFixed(2)}` : '–'}</strong><small>{scores.length ? `${scores.length} employees with a released score` : 'No released employee scores yet'}</small></div>
    <div className="reports-kpi-card"><span>{report.previous_campaign ? 'Improved since last campaign' : 'Self-evaluations completed'}</span><strong>{report.previous_campaign ? `${improved} / ${compared}` : `${kpis.completed_self_evaluations} / ${kpis.assigned_self_evaluations}`}</strong><small>{report.previous_campaign ? `Peer rating up vs. ${report.previous_campaign.name}` : 'Submitted of assigned self-evaluations'}</small></div>
  </section>;
}
