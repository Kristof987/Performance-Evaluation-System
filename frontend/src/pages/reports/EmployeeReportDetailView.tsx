import { useState } from 'react';
import { Link } from 'react-router';
import ReportsEmptyState from './components/ReportsEmptyState';
import EmployeeAIAnalysisPanel from './components/EmployeeAIAnalysisPanel';
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

function selfPeerMessage(data: EmployeeReportDetail) {
  const status = data.coverage.self_evaluation.status;
  if (status === 'Not assigned') return 'No self-evaluation was assigned for this campaign.';
  if (status === 'Not started' || status === 'In progress') return 'Self-evaluation has not been submitted yet.';
  if (data.self_peer_comparison.length > 0) return null;
  if (['no_assignments', 'not_submitted', 'suppressed'].includes(data.section_availability)) return 'Peer feedback is not yet available for comparison.';
  return 'No reportable sections are available for comparison.';
}

export default function EmployeeReportDetailView({ data, onBack, getAccessToken }: { data: EmployeeReportDetail; onBack: () => void; getAccessToken: AccessTokenGetter }) {
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const historyOptions = data.history.map((series) => ({ series, key: series.section_id === null ? 'overall' : `section-${series.section_id}` }));
  const selectedHistory = historyOptions.find((option) => option.key === historyKey) ?? historyOptions.find((option) => option.key === 'overall') ?? historyOptions[0];
  const assigned = data.coverage.peer_assigned;
  const completed = data.coverage.peer_completed;
  const percentage = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
  const message = selfPeerMessage(data);
  const emptyState = sectionEmptyState[data.section_availability];

  return <div className="reports-overview">
    <button className="campaign-details-link link-button" type="button" onClick={onBack}>← Back to Employees</button>
    <header className="reports-detail-heading">
      <h2>{data.employee.name}</h2>
      <p>{data.employee.company_role}{data.employee.groups.length > 0 ? ` · ${data.employee.groups.join(', ')}` : ''}</p>
      <p>{data.campaign.name} · Employee performance analysis</p>
    </header>
    <section className="reports-kpi-panel reports-kpi-panel-compact">
      {[
        ['Completed peer reviews', data.kpis.peer_reviews_received],
        ['Feedback completion', `${completed}/${assigned}`],
        ['Self-evaluation', data.kpis.self_evaluation_status],
        ['Sections analyzed', data.kpis.reportable_sections],
        ['Overall peer score', availabilityLabel(data.section_availability === 'suppressed' ? 'suppressed' : data.kpis.overall_peer_score === null ? 'no_data' : 'available', data.kpis.overall_peer_score)],
        ['Overall self score', formatScore(data.kpis.overall_self_score)],
      ].map(([label, value], index) => <div className={index === 0 ? 'reports-kpi-segment reports-kpi-primary' : 'reports-kpi-segment'} key={label as string}><span>{label}</span><strong>{value}</strong>{index === 1 && <small>{data.kpis.peer_completion_rate === null ? 'No reviews assigned' : `${data.kpis.peer_completion_rate}% complete`}</small>}</div>)}
    </section>
    <EmployeeAIAnalysisPanel campaignId={data.campaign.id} employeeId={data.employee.id} getAccessToken={getAccessToken} />
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Performance by section</h2><p>Aggregated peer feedback by rated section on a 1-5 scale.</p></div>
      {data.sections.length === 0 ? <ReportsEmptyState title={emptyState.title} message={emptyState.message} /> : <div className="reports-dimension-chart">{data.sections.map((section) => <div className="reports-bar-row" key={section.id}>
        <div className="reports-bar-label"><strong>{section.name}</strong><span>Peer: {section.peer_availability === 'available' && section.peer_score !== null ? `${section.peer_evaluator_count} evaluators` : availabilityLabel(section.peer_availability, section.peer_score)}</span><span>Self: {availabilityLabel(section.self_availability, section.self_score)}</span></div>
        {section.peer_availability === 'available' && section.peer_score !== null ? <div className="reports-bar-track"><span style={{ width: `${Math.min(100, (section.peer_score / 5) * 100)}%` }} /></div> : <div />}
        <strong className="reports-bar-value">{availabilityLabel(section.peer_availability, section.peer_score)}</strong>
      </div>)}</div>}
    </section>
    <Link className="campaign-details-link" to={`/reports/campaigns/${data.campaign.id}/questions?employee_id=${data.employee.id}`}>Explore employee questions →</Link>
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Self-evaluation vs peer feedback</h2><p>Comparisons require submitted self-evaluation and reportable peer feedback in the same section.</p></div>
      {message ? <ReportsEmptyState title={message} message="Comparison is unavailable for the current evaluation data." /> : <div className="reports-simple-table"><table><thead><tr><th>Section</th><th>Peer feedback</th><th>Self-evaluation</th><th>Difference</th><th>Interpretation</th></tr></thead><tbody>{data.self_peer_comparison.map((item) => <tr key={item.section_id}><td>{item.section_name}</td><td>{formatScore(item.peer_average)}</td><td>{formatScore(item.self_average)}</td><td>{item.difference.toFixed(2)}</td><td>{item.interpretation}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="reports-card reports-coverage">
      <div className="reports-section-heading"><h2>Evaluation coverage</h2></div>
      {assigned === 0 ? <div className="reports-coverage-meta"><span className="reports-coverage-empty">No peer reviews were assigned for this campaign.</span><span>Deadline: {formatDate(data.coverage.campaign_end_date)}</span></div> : <>
        <div className="reports-coverage-summary"><strong>{completed} of {assigned} peer reviews completed</strong><span>{percentage}%</span></div>
        <div className="reports-coverage-track" role="progressbar" aria-label="Peer review completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage ?? 0}><span style={{ width: `${percentage ?? 0}%` }} /></div>
        <div className="reports-coverage-meta"><span>{data.coverage.peer_outstanding} {data.coverage.peer_outstanding === 1 ? 'review' : 'reviews'} outstanding</span><span>Deadline: {formatDate(data.coverage.campaign_end_date)}</span></div>
      </>}
      <p className="reports-coverage-self">Distinct peer evaluators: {data.coverage.distinct_peer_evaluators ?? 'Hidden for confidentiality'}</p>
      <p className="reports-coverage-self">Self-evaluation: {data.coverage.self_evaluation.status}</p>
    </section>
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Performance over time</h2><p>Historical reportable section and overall peer scores.</p>{historyOptions.length > 0 && <select className="form-control reports-source-select" aria-label="Select history series" value={selectedHistory?.key ?? ''} onChange={(event) => setHistoryKey(event.target.value)}>{historyOptions.map(({ series, key }) => <option key={key} value={key}>{series.section_id === null ? 'Overall' : series.section_name}</option>)}</select>}</div>
      {selectedHistory && selectedHistory.series.points.length > 0 ? <div className="reports-history-points">{selectedHistory.series.points.map((point) => <div className="reports-history-point" key={point.campaign_id}><span>{point.campaign_name}</span><strong>{formatScore(point.average_score)}</strong><small>{formatDate(point.campaign_start_date)} · {point.evaluator_count} evaluators · {point.reportable_sections} {point.reportable_sections === 1 ? 'section' : 'sections'}</small></div>)}</div> : <ReportsEmptyState title="No historical results available." message="Reportable results for this series will appear when available." />}
    </section>
  </div>;
}
