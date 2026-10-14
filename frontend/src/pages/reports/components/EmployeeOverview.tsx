import type { ReportEmployeeOverview } from '../types/reports.types';

export default function EmployeeOverview({ employees }: { employees: ReportEmployeeOverview }) {
  return <section className="reports-card reports-employee-overview"><div className="reports-section-heading"><h2>Employees overview</h2><p>Coverage metrics only. Employee rankings are intentionally not shown.</p></div><div className="reports-employee-grid">
    <div><span>Participating employees</span><strong>{employees.participating_employees}</strong></div>
    <div><span>Received peer feedback</span><strong>{employees.employees_with_completed_peer_feedback}</strong></div>
    <div><span>Awaiting peer feedback</span><strong>{employees.employees_awaiting_peer_feedback}</strong></div>
    <div><span>Self-evaluations completed</span><strong>{employees.completed_self_evaluations}/{employees.configured_self_evaluations}</strong><small>assigned</small></div>
  </div></section>;
}
