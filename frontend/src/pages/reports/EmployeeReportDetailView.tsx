import { useState } from 'react';
import ReportsEmptyState from './components/ReportsEmptyState';
import EmployeeAIAnalysisPanel from './components/EmployeeAIAnalysisPanel';
import QuestionAnalytics from './components/QuestionAnalytics';
import type { EmployeeReportDetail } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { useDates } from '../../app/dates';
import { ChartCard, CsvButton, Delta, GapBars, GroupedBars, ProfileRadar, TrendLines, type TrendSeries } from './charts/DashboardCharts';
import { scoreColor, useChartTheme } from './charts/chartTheme';
import { csvScore } from './reportExport';
import { useNavigate } from 'react-router';

function formatScore(value: number | null) {
  if (value === null) return '—';
  return `${value.toFixed(2)} / 5`;
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

type Profile = { key: string; name: string; color: string; values: Record<string, number | null>; dashed?: boolean; filled?: boolean };

export default function EmployeeReportDetailView({ data, onBack, getAccessToken }: { data: EmployeeReportDetail; onBack: () => void; getAccessToken: AccessTokenGetter }) {
  const dates = useDates();
  const theme = useChartTheme();
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [benchmarkGroupId, setBenchmarkGroupId] = useState<number | null>(null);
  const [focusSection, setFocusSection] = useState<{ id: number; request: number } | null>(null);
  const navigate = useNavigate();
  const openQuestions = (sectionId: number) => setFocusSection((current) => ({ id: sectionId, request: (current?.request ?? 0) + 1 }));
  const historyOptions = data.history.map((series) => ({ series, key: series.section_id === null ? 'overall' : `section-${series.section_id}` }));
  const overallHistory = historyOptions.find((option) => option.key === 'overall');
  const selectedHistory = historyOptions.find((option) => option.key === historyKey) ?? overallHistory ?? historyOptions[0];
  const assigned = data.coverage.peer_assigned;
  const completed = data.coverage.peer_completed;
  const percentage = assigned > 0 ? Math.round((completed / assigned) * 100) : null;
  const emptyState = sectionEmptyState[data.section_availability];

  const peerOf = (section: EmployeeReportDetail['sections'][number]) => section.peer_availability === 'available' ? section.peer_score : null;
  const selfOf = (section: EmployeeReportDetail['sections'][number]) => section.self_availability === 'available' ? section.self_score : null;
  const scoredSections = data.sections.filter((section) => peerOf(section) !== null);
  const hiddenSections = data.sections.filter((section) => section.peer_availability === 'suppressed');
  const benchmarkGroup = data.benchmarks.groups.find((group) => group.id === benchmarkGroupId) ?? data.benchmarks.groups[0];
  const overall = data.section_availability === 'suppressed' ? null : data.kpis.overall_peer_score;
  const previousOverall = data.previous?.overall_peer_score ?? null;
  const vsPrevious = data.previous_campaign ? `vs. ${data.previous_campaign.name}` : '';
  const profiles: Profile[] = [
    { key: 'employee', name: data.employee.name, color: theme.primary, filled: true, values: Object.fromEntries(scoredSections.map((section) => [String(section.id), peerOf(section)])) },
    ...(benchmarkGroup && Object.values(benchmarkGroup.sections).some((value) => value !== null) ? [{ key: 'group', name: `${benchmarkGroup.name} average`, color: theme.series[1], dashed: true, values: benchmarkGroup.sections }] : []),
    ...(data.benchmarks.campaign && Object.values(data.benchmarks.campaign.sections).some((value) => value !== null) ? [{ key: 'campaign', name: 'Campaign average', color: theme.textMuted, dashed: true, values: data.benchmarks.campaign.sections }] : []),
  ];
  const gaps = scoredSections.flatMap((section) => {
    const peer = peerOf(section);
    const self = selfOf(section);
    return peer !== null && self !== null ? [{ id: section.id, name: section.name, peer, self }] : [];
  });
  const trendSeries: TrendSeries[] = [
    ...(selectedHistory && selectedHistory.key !== 'overall' ? [{ key: selectedHistory.key, name: selectedHistory.series.section_name, color: theme.primary }] : []),
    ...(overallHistory ? [{ key: 'overall', name: 'Overall peer rating', color: selectedHistory?.key === 'overall' ? theme.primary : theme.textMuted, dashed: selectedHistory?.key !== 'overall' }] : []),
  ];
  const trendCampaigns = new Map<number, { label: string; fullName: string; start: string }>();
  for (const option of [overallHistory, selectedHistory]) for (const point of option?.series.points ?? []) trendCampaigns.set(point.campaign_id, { label: point.campaign_name.length > 14 ? `${point.campaign_name.slice(0, 13)}…` : point.campaign_name, fullName: point.campaign_name, start: point.campaign_start_date });
  const trendPoints = [...trendCampaigns.entries()].sort((a, b) => a[1].start.localeCompare(b[1].start)).map(([campaignId, campaign]) => ({
    campaignId,
    label: campaign.label,
    fullName: `${campaign.fullName} · ${dates.day(campaign.start, undefined, '')}`,
    overall: overallHistory?.series.points.find((point) => point.campaign_id === campaignId)?.average_score ?? null,
    ...(selectedHistory && selectedHistory.key !== 'overall' ? { [selectedHistory.key]: selectedHistory.series.points.find((point) => point.campaign_id === campaignId)?.average_score ?? null } : {}),
  }));

  return <div className="reports-overview reports-employee-detail">
    <div className="reports-employee-navigation"><button className="campaign-details-link link-button" type="button" onClick={onBack}>← Back to Employees</button><div className="reports-employee-jump-links"><a href="#employee-question-analytics">Question Analytics ↓</a><a href="#employee-ai-analysis">AI Performance Analysis ↓</a></div></div>
    <header className="reports-detail-heading reports-employee-heading">
      <h2>{data.employee.name}</h2>
      <p>{data.employee.company_role}{data.employee.groups.length > 0 ? ` · ${data.employee.groups.join(', ')}` : ''}</p>
    </header>
    <section className="reports-kpi-row" aria-label="Employee results summary">
      <div className="reports-kpi-card"><span>Overall peer rating</span><strong>{overall !== null && <i className="reports-kpi-marker" style={{ background: scoreColor(theme, overall) }} aria-hidden="true" />}{availabilityLabel(data.section_availability === 'suppressed' ? 'suppressed' : overall === null ? 'no_data' : 'available', overall)}</strong>
        <small>{overall !== null && previousOverall !== null ? <><Delta current={overall} previous={previousOverall} label={vsPrevious} /> {vsPrevious}</> : data.kpis.reportable_sections > 0 ? `${data.kpis.reportable_sections} scored ${data.kpis.reportable_sections === 1 ? 'section' : 'sections'}` : 'Employee-balanced sections'}</small></div>
      <div className="reports-kpi-card"><span>{benchmarkGroup ? `${benchmarkGroup.name} average` : 'Overall self rating'}</span>{benchmarkGroup
        ? <><strong>{benchmarkGroup.overall === null ? '–' : benchmarkGroup.overall.toFixed(2)}</strong><small>{overall !== null && benchmarkGroup.overall !== null ? <><Delta current={overall} previous={benchmarkGroup.overall} label="vs. group average" /> employee vs. group</> : 'Group average'}</small></>
        : <><strong>{data.kpis.overall_self_score === null ? 'No data' : formatScore(data.kpis.overall_self_score)}</strong><small>Self-evaluation sections</small></>}</div>
      <div className="reports-kpi-card"><span>Self rating</span><strong>{data.kpis.overall_self_score === null ? '–' : data.kpis.overall_self_score.toFixed(2)}</strong><small>{overall !== null && data.kpis.overall_self_score !== null ? <><Delta current={data.kpis.overall_self_score} previous={overall} label="self minus peer rating" /> self − peer</> : data.coverage.self_evaluation.assigned > 0 ? `${data.coverage.self_evaluation.completed} / ${data.coverage.self_evaluation.assigned} submitted` : 'No self-evaluation assigned'}</small></div>
      <div className="reports-kpi-card"><span>Peer reviews completed</span><strong>{completed} / {assigned}</strong><small>{assigned === 0 ? 'None assigned' : percentage === 100 ? 'All assigned reviews submitted' : `${percentage}% of assigned reviews`}</small></div>
    </section>
    {scoredSections.length === 0 ? <section className="reports-card"><ReportsEmptyState title={emptyState.title} message={emptyState.message} /></section> : <div className="reports-viz-grid">
      <ChartCard title="Section profile" subtitle={`Peer rating per section, 1–5 · click a section for its questions${hiddenSections.length ? ` · ${hiddenSections.length} hidden for confidentiality` : ''}`}
        actions={<span className="reports-card-actions"><CsvButton name={`${data.employee.name} ${data.campaign.name} sections`} rows={() => [
          ['Section', 'Peer rating', 'Self rating', data.previous_campaign ? `Previous (${data.previous_campaign.name})` : 'Previous', ...(benchmarkGroup ? [`${benchmarkGroup.name} average`] : []), ...(data.benchmarks.campaign ? ['Campaign average'] : [])],
          ...data.sections.map((section) => [section.name, csvScore(section.peer_score, section.peer_availability), csvScore(section.self_score, section.self_availability), csvScore(data.previous?.sections[String(section.id)]),
            ...(benchmarkGroup ? [csvScore(benchmarkGroup.sections[String(section.id)])] : []), ...(data.benchmarks.campaign ? [csvScore(data.benchmarks.campaign.sections[String(section.id)])] : [])]),
        ]} />{data.benchmarks.groups.length > 1 && <label className="reports-q-order reports-no-print"><span>Group</span><select value={benchmarkGroup?.id} onChange={(event) => setBenchmarkGroupId(Number(event.target.value))}>{data.benchmarks.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</span>}>
        {scoredSections.length >= 3
          ? <ProfileRadar theme={theme} sections={scoredSections} series={profiles} onSelect={openQuestions} />
          : <GroupedBars theme={theme} categories={scoredSections} series={profiles.map((profile, index) => ({ id: index, name: profile.name, color: profile.color, values: profile.values }))} />}
      </ChartCard>
      <ChartCard title="Self vs. peers" subtitle={gaps.length ? 'Self minus peer rating per section · right = rates themself higher, left = lower' : undefined}>
        {gaps.length ? <GapBars theme={theme} rows={gaps} onSelect={openQuestions} /> : <p className="reports-chart-notice">{data.kpis.overall_self_score === null ? 'No submitted self-evaluation to compare with.' : 'No section has both a self and a released peer rating.'}</p>}
      </ChartCard>
    </div>}
    {trendPoints.length > 1 && trendSeries.length > 0 && <ChartCard title="Over time" subtitle="Peer rating in earlier reportable campaigns · click a point to open that campaign"
      actions={historyOptions.length > 1 ? <label className="reports-q-order"><span>Show</span><select value={selectedHistory?.key} onChange={(event) => setHistoryKey(event.target.value)}>{historyOptions.map(({ series, key }) => <option key={key} value={key}>{series.section_id === null ? 'Overall' : series.section_name}</option>)}</select></label> : undefined}>
      <TrendLines theme={theme} points={trendPoints} series={trendSeries} onSelect={(point) => { if (typeof point.campaignId === 'number' && point.campaignId !== data.campaign.id) navigate(`/reports/campaigns/${point.campaignId}/employees/${data.employee.id}`); }} />
    </ChartCard>}
    <div id="employee-question-analytics"><QuestionAnalytics campaignId={data.campaign.id} getAccessToken={getAccessToken} scope={{ employee_id: data.employee.id }} feedbackStatus={data.campaign.campaign_status} focusSection={focusSection} /></div>
    <div id="employee-ai-analysis"><EmployeeAIAnalysisPanel scope={{ type: 'employee', campaignId: data.campaign.id, employeeId: data.employee.id }} getAccessToken={getAccessToken} /></div>
    <section className="reports-card reports-employee-coverage">
      <h2>Evaluation coverage</h2>
      <div className="reports-employee-coverage-facts"><span>{assigned === 0 ? 'No peer reviews assigned' : completed === assigned ? 'All assigned peer reviews completed' : `${data.coverage.peer_outstanding} ${data.coverage.peer_outstanding === 1 ? 'review' : 'reviews'} outstanding`}</span><span>Distinct peer evaluators: {data.coverage.distinct_peer_evaluators ?? 'Restricted'}</span>{data.coverage.campaign_end_date && <span>Campaign deadline: {dates.day(data.coverage.campaign_end_date, undefined, 'No deadline')}</span>}</div>
      {assigned > 0 && completed < assigned && <div className="reports-employee-coverage-track" role="progressbar" aria-label="Peer review completion" aria-valuemin={0} aria-valuemax={assigned} aria-valuenow={completed}><span style={{ width: `${percentage ?? 0}%` }} /></div>}
    </section>
  </div>;
}
