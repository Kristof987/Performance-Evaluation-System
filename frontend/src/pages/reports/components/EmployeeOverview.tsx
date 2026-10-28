import type { EmployeeReportsOverview } from '../types/reports.types';

export default function EmployeeOverview({ report }: { report: EmployeeReportsOverview }) {
  return <section className="reports-kpi-panel reports-employee-kpis" aria-label="Employee reporting summary">
    <div className="reports-kpi-segment"><span>Participating employees</span><strong>{report.kpis.participating_employees}</strong><small>Distinct campaign participants</small></div>
    <div className="reports-kpi-segment"><span>Peer reviews completed</span><strong>{report.kpis.peer_reviews_completed} / {report.kpis.peer_reviews_assigned}</strong><small>Submitted of assigned peer reviews</small></div>
    <div className="reports-kpi-segment"><span>Employees with peer feedback</span><strong>{report.kpis.employees_with_peer_feedback}</strong><small>Distinct evaluated employees</small></div>
    <div className="reports-kpi-segment"><span>Self-evaluations completed</span><strong>{report.kpis.completed_self_evaluations} / {report.kpis.assigned_self_evaluations}</strong><small>Submitted of assigned self-evaluations</small></div>
  </section>;
}
