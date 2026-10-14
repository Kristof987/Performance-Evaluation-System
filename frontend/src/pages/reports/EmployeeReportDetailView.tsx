import ReportsEmptyState from './components/ReportsEmptyState';
import type { EmployeeReportDetail } from './types/reports.types';

function formatScore(value: number | null, scaleMax?: number | null) {
  if (value === null) return '—';
  return scaleMax ? `${value.toFixed(2)} / ${scaleMax}` : value.toFixed(2);
}

function formatDate(value: string | null) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

const dimensionEmptyState: Record<EmployeeReportDetail['dimension_availability'], { title: string; message: string }> = {
  no_assignments: { title: 'No peer evaluations assigned.', message: 'Performance dimensions will appear after peer evaluations are assigned and completed.' },
  not_submitted: { title: 'No peer feedback submitted yet.', message: 'Performance dimensions will appear after evaluations are completed.' },
  no_dimensions: { title: 'No performance dimensions available.', message: 'Submitted questionnaires do not contain comparable rated competencies.' },
  no_compatible_responses: { title: 'No comparable scores available.', message: 'Submitted evaluations do not contain valid compatible numerical responses.' },
  suppressed: { title: 'Not enough feedback to display results.', message: 'Individual scores will appear when reporting confidentiality requirements are met.' },
  available: { title: 'No performance dimensions available.', message: 'No reportable dimension results are available.' },
};

function selfPeerMessage(data: EmployeeReportDetail) {
  const status = data.coverage.self_evaluation.status;
  if (status === 'Not assigned') return 'No self-evaluation was assigned for this campaign.';
  if (status === 'Not started' || status === 'In progress') return 'Self-evaluation has not been submitted yet.';
  if (data.self_peer_comparison.length > 0) return null;
  if (['no_assignments', 'not_submitted', 'suppressed'].includes(data.dimension_availability)) return 'Peer feedback is not yet available for comparison.';
  return 'No compatible dimensions are available for comparison.';
}

export default function EmployeeReportDetailView({ data, selectedHistory, onBack }: { data: EmployeeReportDetail; selectedHistory: EmployeeReportDetail['history'][number] | null; onBack: () => void }) {
  const assigned = data.coverage.peer_assigned;
  const completed = data.coverage.peer_completed;
  const percentage = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
  const message = selfPeerMessage(data);
  const emptyState = dimensionEmptyState[data.dimension_availability];

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
        ['Dimensions analyzed', data.kpis.reportable_dimensions],
      ].map(([label, value], index) => <div className={index === 0 ? 'reports-kpi-segment reports-kpi-primary' : 'reports-kpi-segment'} key={label as string}><span>{label}</span><strong>{value}</strong>{index === 1 && <small>{data.kpis.peer_completion_rate === null ? 'No reviews assigned' : `${data.kpis.peer_completion_rate}% complete`}</small>}</div>)}
    </section>
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Performance by dimension</h2><p>Explore aggregated feedback across evaluated competencies.</p></div>
      {data.dimension_availability !== 'available' ? <ReportsEmptyState title={emptyState.title} message={emptyState.message} /> : <div className="reports-dimension-chart">{data.dimensions.map((dimension) => <div className="reports-bar-row" key={dimension.id}>
        <div className="reports-bar-label"><strong>{dimension.name}</strong><span>{dimension.suppressed ? 'Hidden for confidentiality' : `${dimension.response_count} responses · ${dimension.evaluator_count} evaluators · ${dimension.scale_min}-${dimension.scale_max} scale`}</span></div>
        <div className="reports-bar-track"><span style={{ width: `${dimension.average_score === null ? 0 : Math.min(100, (dimension.average_score / dimension.scale_max) * 100)}%` }} /></div>
        <strong className="reports-bar-value">{formatScore(dimension.average_score)}</strong>
      </div>)}</div>}
    </section>
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Self-evaluation vs peer feedback</h2><p>Comparisons require submitted self-evaluation and reportable peer feedback on compatible dimensions.</p></div>
      {message ? <ReportsEmptyState title={message} message="Comparison is unavailable for the current evaluation data." /> : <div className="reports-simple-table"><table><thead><tr><th>Dimension</th><th>Peer feedback</th><th>Self-evaluation</th><th>Difference</th></tr></thead><tbody>{data.self_peer_comparison.map((item) => <tr key={item.dimension_id}><td>{item.dimension_name}</td><td>{formatScore(item.peer_average, item.scale_max)}</td><td>{formatScore(item.self_average, item.scale_max)}</td><td>{formatScore(item.difference)}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="reports-card reports-coverage">
      <div className="reports-section-heading"><h2>Evaluation coverage</h2></div>
      {assigned === 0 ? <div className="reports-coverage-meta"><span className="reports-coverage-empty">No peer reviews were assigned for this campaign.</span><span>Deadline: {formatDate(data.coverage.campaign_end_date)}</span></div> : <>
        <div className="reports-coverage-summary"><strong>{completed} of {assigned} peer reviews completed</strong><span>{percentage}%</span></div>
        <div className="reports-coverage-track" role="progressbar" aria-label="Peer review completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage ?? 0}><span style={{ width: `${percentage ?? 0}%` }} /></div>
        <div className="reports-coverage-meta"><span>{data.coverage.peer_outstanding} {data.coverage.peer_outstanding === 1 ? 'review' : 'reviews'} outstanding</span><span>Deadline: {formatDate(data.coverage.campaign_end_date)}</span></div>
      </>}
      <p className="reports-coverage-self">Self-evaluation: {data.coverage.self_evaluation.status}</p>
    </section>
    <section className="reports-card">
      <div className="reports-section-heading"><h2>Performance over time</h2><p>Historical results use compatible issued questionnaire snapshots.</p></div>
      {selectedHistory ? <div className="reports-history-points">{selectedHistory.points.map((point) => <div className="reports-history-point" key={point.campaign_id}><span>{point.campaign_name}</span><strong>{formatScore(point.average_score, selectedHistory.scale_max)}</strong><small>{formatDate(point.campaign_start_date)}</small></div>)}</div> : <ReportsEmptyState title="More campaign results are needed." message="Compatible, reportable results from multiple campaigns are required to show a trend." />}
    </section>
  </div>;
}
