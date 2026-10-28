import { useState } from 'react';
import ReportsEmptyState from './components/ReportsEmptyState';
import EmployeeAIAnalysisPanel from './components/EmployeeAIAnalysisPanel';
import QuestionAnalytics from './components/QuestionAnalytics';
import type { EmployeeReportDetail } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';

function formatScore(value: number | null) {
  if (value === null) return '—';
  return `${value.toFixed(2)} / 5`;
}

function formatDate(value: string | null) {
  if (!value) return 'No deadline';
  const timestamp = value.includes('T');
  const parsed = new Date(timestamp ? value : `${value}T00:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    timeZone: timestamp ? 'Europe/Budapest' : 'UTC',
  }).format(parsed);
}

const sectionEmptyState: Record<EmployeeReportDetail['section_availability'], { title: string; message: string }> = {
  no_assignments: { title: 'No peer evaluations assigned.', message: 'Performance sections will appear after peer evaluations are assigned and completed.' },
  not_submitted: { title: 'No peer feedback submitted yet.', message: 'Performance sections will appear after evaluations are completed.' },
  no_sections: { title: 'No performance sections available.', message: 'Submitted questionnaires do not contain rated sections.' },
  no_ratings: { title: 'No section scores available.', message: 'Submitted evaluations do not contain valid numerical ratings.' },
  suppressed: { title: 'Not enough feedback to display results.', message: 'Individual scores will appear when reporting confidentiality requirements are met.' },
  available: { title: 'No performance sections available.', message: 'No reportable section results are available.' },
};

function availabilityLabel(availability: 'available' | 'suppressed' | 'no_data', score: number | null) {
  if (availability === 'suppressed') return 'Hidden for confidentiality';
  if (availability === 'no_data' || score === null) return 'Not yet available';
  return formatScore(score);
}

export default function EmployeeReportDetailView({ data, onBack, getAccessToken }: { data: EmployeeReportDetail; onBack: () => void; getAccessToken: AccessTokenGetter }) {
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const historyOptions = data.history.map((series) => ({ series, key: series.section_id === null ? 'overall' : `section-${series.section_id}` }));
  const selectedHistory = historyOptions.find((option) => option.key === historyKey) ?? historyOptions.find((option) => option.key === 'overall') ?? historyOptions[0];
  const assigned = data.coverage.peer_assigned;
  const completed = data.coverage.peer_completed;
  const percentage = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
  const emptyState = sectionEmptyState[data.section_availability];

  return <div className="reports-overview reports-employee-detail">
    <div className="reports-employee-navigation"><button className="campaign-details-link link-button" type="button" onClick={onBack}>← Back to Employees</button><div className="reports-employee-jump-links"><a href="#employee-question-analytics">Question Analytics ↓</a><a href="#employee-ai-analysis">AI Performance Analysis ↓</a></div></div>
    <header className="reports-detail-heading reports-employee-heading">
      <h2>{data.employee.name}</h2>
      <p>{data.employee.company_role}{data.employee.groups.length > 0 ? ` · ${data.employee.groups.join(', ')}` : ''}</p>
    </header>
    <section className="reports-employee-summary" aria-label="Employee results summary">
      <div className="reports-card"><span>Overall peer score</span><strong>{availabilityLabel(data.section_availability === 'suppressed' ? 'suppressed' : data.kpis.overall_peer_score === null ? 'no_data' : 'available', data.kpis.overall_peer_score)}</strong><small>{data.kpis.reportable_sections > 0 ? `${data.kpis.reportable_sections} scored ${data.kpis.reportable_sections === 1 ? 'section' : 'sections'}` : 'Employee-balanced sections'}</small></div>
      <div className="reports-card"><span>Overall self score</span><strong>{data.kpis.overall_self_score === null ? 'No data' : formatScore(data.kpis.overall_self_score)}</strong><small>Self-evaluation sections</small></div>
      <div className="reports-card"><span>Peer reviews completed</span><strong>{completed} / {assigned}</strong><small>{assigned === 0 ? 'None assigned' : percentage === 100 ? 'All assigned reviews submitted' : `${percentage}% of assigned reviews`}</small></div>
      <div className="reports-card"><span>Self-evaluation</span><strong>{data.kpis.self_evaluation_status}</strong><small>{data.coverage.self_evaluation.assigned > 0 ? `${data.coverage.self_evaluation.completed} / ${data.coverage.self_evaluation.assigned} submitted` : 'No evaluation assigned'}</small></div>
    </section>
    <section className="reports-card reports-employee-sections">
      <div className="reports-section-heading"><h2>Self vs. Peer by Section</h2><p>Normalized 1–5 section scores. Peer averages balance evaluators; self scores are separate.</p></div>
      {data.sections.length === 0 ? <ReportsEmptyState title={emptyState.title} message={emptyState.message} /> : <div className="reports-employee-section-list">{data.sections.map((section) => {
        const peer = section.peer_availability === 'available' ? section.peer_score : null;
        const self = section.self_availability === 'available' ? section.self_score : null;
        const comparison = data.self_peer_comparison.find((item) => item.section_id === section.id);
        const difference = peer !== null && self !== null && comparison ? comparison.difference : null;
        return <div className="reports-employee-section" key={section.id}>
          <div className="reports-employee-section-heading"><strong>{section.name}</strong>{difference !== null && <small>{Math.abs(difference) < 0.005 ? 'Equal' : difference > 0 ? `Self +${difference.toFixed(2)}` : `Peer +${Math.abs(difference).toFixed(2)}`}</small>}</div>
          <div className="reports-employee-section-series"><span>Peer</span><div className="reports-employee-section-track">{peer !== null && <i className="is-peer" style={{ width: `${Math.min(100, Math.max(0, peer / 5 * 100))}%` }} />}</div><b>{availabilityLabel(section.peer_availability, peer)}</b></div>
          <div className="reports-employee-section-series"><span>Self</span><div className="reports-employee-section-track">{self !== null && <i className="is-self" style={{ width: `${Math.min(100, Math.max(0, self / 5 * 100))}%` }} />}</div><b>{availabilityLabel(section.self_availability, self)}</b></div>
          {peer !== null && section.peer_evaluator_count > 0 && <small className="reports-employee-section-coverage">{section.peer_evaluator_count} distinct peer {section.peer_evaluator_count === 1 ? 'evaluator' : 'evaluators'}</small>}
        </div>;
      })}</div>}
    </section>
    <div id="employee-question-analytics"><QuestionAnalytics campaignId={data.campaign.id} getAccessToken={getAccessToken} scope={{ employee_id: data.employee.id }} /></div>
    <div id="employee-ai-analysis"><EmployeeAIAnalysisPanel scope={{ type: 'employee', campaignId: data.campaign.id, employeeId: data.employee.id }} getAccessToken={getAccessToken} /></div>
    <section className="reports-card reports-employee-coverage">
      <h2>Evaluation coverage</h2>
      <div className="reports-employee-coverage-facts"><span>{assigned === 0 ? 'No peer reviews assigned' : completed === assigned ? 'All assigned peer reviews completed' : `${data.coverage.peer_outstanding} ${data.coverage.peer_outstanding === 1 ? 'review' : 'reviews'} outstanding`}</span><span>Distinct peer evaluators: {data.coverage.distinct_peer_evaluators ?? 'Restricted'}</span>{data.coverage.campaign_end_date && <span>Campaign deadline: {formatDate(data.coverage.campaign_end_date)}</span>}</div>
      {assigned > 0 && completed < assigned && <div className="reports-employee-coverage-track" role="progressbar" aria-label="Peer review completion" aria-valuemin={0} aria-valuemax={assigned} aria-valuenow={completed}><span style={{ width: `${percentage ?? 0}%` }} /></div>}
    </section>
    {selectedHistory && selectedHistory.series.points.length > 0 && <section className="reports-card">
      <div className="reports-section-heading"><h2>Performance over time</h2><p>Historical reportable section and overall peer scores.</p><select className="form-control reports-source-select" aria-label="Select history series" value={selectedHistory.key} onChange={(event) => setHistoryKey(event.target.value)}>{historyOptions.map(({ series, key }) => <option key={key} value={key}>{series.section_id === null ? 'Overall' : series.section_name}</option>)}</select></div>
      <div className="reports-history-points">{selectedHistory.series.points.map((point) => <div className="reports-history-point" key={point.campaign_id}><span>{point.campaign_name}</span><strong>{formatScore(point.average_score)}</strong><small>{formatDate(point.campaign_start_date)} · {point.evaluator_count} evaluators · {point.reportable_sections} {point.reportable_sections === 1 ? 'section' : 'sections'}</small></div>)}</div>
    </section>}
  </div>;
}
