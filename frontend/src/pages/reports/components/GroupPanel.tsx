import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import LoadError from '../../../components/feedback/LoadError';
import LoadingState from '../../../components/feedback/LoadingState';
import { fetchGroupReportDetail } from '../api/reports.api';
import { ChartCard, CsvButton, Delta } from '../charts/DashboardCharts';
import { scoreColor, useChartTheme } from '../charts/chartTheme';
import type { DashboardGroup, GroupReportDetail } from '../types/reports.types';
import EmployeeAIAnalysisPanel from './EmployeeAIAnalysisPanel';

type Member = GroupReportDetail['employees'][number];

function memberScore(member: Member) {
  if (member.peer_score != null) return member.peer_score.toFixed(2);
  return member.score_availability === 'suppressed' ? 'Hidden' : '–';
}

/** One group in focus on the Overview: its figures, the group-level AI summary and its members. */
export default function GroupPanel({ campaignId, group, campaignScore, campaignLabel = 'all groups', getAccessToken }: { campaignId: number; group: DashboardGroup; campaignScore: number | null; campaignLabel?: string; getAccessToken: AccessTokenGetter | undefined }) {
  const theme = useChartTheme();
  const [detail, setDetail] = useState<GroupReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    fetchGroupReportDetail(getAccessToken, campaignId, group.id, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setDetail(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Group members could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, group.id, getAccessToken, reload]);

  const score = group.overall.availability === 'available' ? group.overall.score : null;
  const members = detail && detail.group.id === group.id ? detail.employees : null;

  return <section className="reports-group-panel" aria-label={`${group.name} summary`}>
    <div className="reports-card reports-group-panel-summary">
    <header className="reports-group-panel-head">
      <div><h2>{group.name}</h2><p>{detail?.group.description || 'Group summary'}</p></div>
    </header>
    <div className="reports-group-panel-kpis">
      <div><span>Members</span><strong>{group.employee_count}</strong></div>
      <div><span>Completion</span><strong>{group.completion_rate === null ? '–' : `${group.completion_rate}%`}</strong><small>{group.completed_evaluations} / {group.total_evaluations} evaluations</small></div>
      <div><span>Peer rating</span><strong style={score !== null ? { color: scoreColor(theme, score) } : undefined}>{score === null ? (group.overall.availability === 'suppressed' ? 'Hidden' : '–') : score.toFixed(2)}</strong>{group.overall.previous_score != null && <small><Delta current={score} previous={group.overall.previous_score} label="vs. previous campaign" /> vs. previous</small>}</div>
      <div><span>vs. {campaignLabel}</span><strong>{score !== null && campaignScore !== null ? `${score - campaignScore >= 0 ? '+' : '−'}${Math.abs(score - campaignScore).toFixed(2)}` : '–'}</strong>{campaignScore !== null && <small>{campaignLabel[0].toUpperCase() + campaignLabel.slice(1)}: {campaignScore.toFixed(2)}</small>}</div>
    </div>
    </div>

    {getAccessToken && <div className="reports-group-panel-ai"><EmployeeAIAnalysisPanel scope={{ type: 'group', campaignId, groupId: group.id }} getAccessToken={getAccessToken} /></div>}

    <ChartCard title="Members" subtitle="Peer rating across the whole campaign · hidden below the privacy threshold"
      actions={members && members.length > 0 ? <CsvButton name={`${group.name} members`} rows={() => [['Employee', 'Role', 'Reviews received', 'Reviews assigned', 'Self-evaluation', 'Peer rating'], ...members.map((member) => [member.employee_name, member.role_name, member.reviews_received, member.reviews_assigned ?? '', member.completed_self_evaluation ? 'Completed' : 'Not completed', member.peer_score != null ? member.peer_score.toFixed(2) : ''])]} /> : undefined}>
      {error ? <LoadError message={error} onRetry={() => { setError(''); setReload((value) => value + 1); }} />
        : !members ? <LoadingState variant="section" label="Loading members" />
        : members.length === 0 ? <p className="reports-chart-notice">This group has no members in the campaign.</p>
        : <div className="reports-group-members" role="table" aria-label={`${group.name} members`}>
          <div role="row" className="reports-group-member is-head"><span role="columnheader">Employee</span><span role="columnheader">Role</span><span role="columnheader">Reviews</span><span role="columnheader">Self</span><span role="columnheader">Peer rating</span></div>
          {members.map((member) => <div role="row" key={member.employee_id} className="reports-group-member">
            <span role="cell"><Link to={`/reports/campaigns/${campaignId}/employees/${member.employee_id}`}>{member.employee_name}</Link></span>
            <span role="cell">{member.role_name}</span>
            <span role="cell">{member.reviews_assigned != null ? `${member.reviews_received} / ${member.reviews_assigned}` : member.reviews_received}</span>
            <span role="cell">{member.completed_self_evaluation ? '✓' : '–'}</span>
            <span role="cell" className={member.peer_score == null ? 'is-muted' : undefined} style={member.peer_score != null ? { color: scoreColor(theme, member.peer_score) } : undefined}>{memberScore(member)}</span>
          </div>)}
        </div>}
    </ChartCard>
  </section>;
}
