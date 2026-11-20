import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { fetchGroupReportDetail, fetchGroupsReport } from './api/reports.api';
import ReportsEmptyState from './components/ReportsEmptyState';
import EmployeeAIAnalysisPanel from './components/EmployeeAIAnalysisPanel';
import SectionScoresChart from './components/SectionScoresChart';
import ReportsLayout from './ReportsLayout';
import type { GroupReportDetail, GroupsReport } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { useAppAuth } from '../../auth/AppAuth';
import { hasTeamReportsOnly } from '../../app/access';
import LoadError from '../../components/feedback/LoadError';
import LoadingState from '../../components/feedback/LoadingState';

function useTeamReportsOnly() {
  const { state } = useAppAuth();
  return state.status === 'authenticated' && hasTeamReportsOnly(state.user.permissions);
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${value}%`;
}

function formatScore(value: number | null) {
  return value === null ? '—' : value.toFixed(2);
}

function reportableScore(value: number | null, availability: 'available' | 'no_data' | 'suppressed') {
  return availability === 'suppressed' ? 'Suppressed' : formatScore(value);
}

function LoadingOrError({ error, retry }: { error: string; retry: () => void }) {
  if (error) {
    return <LoadError message={error} onRetry={retry} />;
  }
  return <LoadingState variant="page" label="Loading report" />;
}

function ReportKpis({ items }: { items: Array<{ label: string; value: string | number; context?: string }> }) {
  return <section className="reports-kpi-panel reports-kpi-panel-compact">{items.map((item, index) => <div className={index === 0 ? 'reports-kpi-segment reports-kpi-primary' : 'reports-kpi-segment'} key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.context && <small>{item.context}</small>}</div>)}</section>;
}

/**
 * Group reports for group leaders. Everyone else compares groups and roles on the Overview,
 * so their old Groups, Roles and detail links open the matching Overview view.
 */
export function GroupsRolesPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;
  const location = useLocation();
  const teamOnly = useTeamReportsOnly();
  if (!teamOnly && validCampaignId) return <Navigate to={`/reports/campaigns/${selectedCampaignId}${location.pathname.includes('/roles') ? '?by=roles' : ''}`} replace />;
  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{(layout) => <GroupsRolesContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layout} />}</ReportsLayout>;
}

function GroupsRolesContent({ selectedCampaignId, validCampaignId, getAccessToken, loadingCampaigns, campaignsError, campaigns, retryCampaigns }: { selectedCampaignId: number; validCampaignId: boolean; getAccessToken: AccessTokenGetter | undefined; loadingCampaigns: boolean; campaignsError: string; campaigns: Array<{ id: number }>; retryCampaigns: () => void }) {
  const [groupData, setGroupData] = useState<GroupsReport | null>(null);
  const [groupError, setGroupError] = useState('');
  const [reloadGroups, setReloadGroups] = useState(0);
  useEffect(() => {
    if (!validCampaignId || !getAccessToken) return undefined;
    const controller = new AbortController();
    setGroupData(null);
    setGroupError('');
    fetchGroupsReport(getAccessToken, selectedCampaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setGroupData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setGroupError(cause instanceof Error ? cause.message : 'Group reports could not be loaded.'); });
    return () => controller.abort();
  }, [selectedCampaignId, getAccessToken, reloadGroups, validCampaignId]);
  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <LoadingState variant="page" label="Loading campaigns" />;
  if (campaignsError) return <LoadError message={campaignsError} onRetry={retryCampaigns} />;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  return <div className="reports-overview">{groupData?.campaign.id === selectedCampaignId ? <GroupsOverview data={groupData} campaignId={selectedCampaignId} /> : <LoadingOrError error={groupError} retry={() => setReloadGroups((value) => value + 1)} />}</div>;
}

function GroupsOverview({ campaignId, data }: { campaignId: number; data: GroupsReport }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => data.groups.filter((group) => group.group_name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.group_name.localeCompare(b.group_name)), [data, query]);

  const hasCompleted = data.groups.some((group) => group.completed_evaluations > 0);
  const hasScores = data.groups.some((group) => group.average_score !== null);
  const hasSuppressed = data.groups.some((group) => group.score_availability === 'suppressed');

  return <>
    <ReportKpis items={[{ label: 'Groups in campaign', value: data.kpis.groups_in_campaign }, { label: 'Participating employees', value: data.kpis.participating_employees, context: 'Deduplicated across groups' }, { label: 'Completed evaluations', value: data.kpis.completed_evaluations }, { label: 'Groups with reportable results', value: data.kpis.groups_with_reportable_results, context: 'Depends on privacy and eligible rating data' }]} />
    <section className="reports-card reports-table reports-wide-card">
      <div className="reports-section-heading reports-section-heading-row"><div><h2>Group comparison</h2><p>Assignment-attributed evaluations. Evaluations show completed / total.</p></div><input className="form-control reports-search" placeholder="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {data.groups.length === 0 ? <ReportsEmptyState title="No groups assigned to this campaign." message="Assign company groups to this campaign before group analytics can be shown." />
        : groups.length === 0 ? <ReportsEmptyState title="No groups found." message="No campaign groups match the current search." />
        : <>
          {!hasCompleted && <ReportsEmptyState title="No completed evaluations yet." message="Group scores will appear when sufficient submitted results are available." />}
          {hasCompleted && hasSuppressed && <ReportsEmptyState title="Some results are hidden to protect confidentiality." message="Submitted scores may be withheld by reporting privacy rules." />}
          {hasCompleted && !hasScores && !hasSuppressed && <ReportsEmptyState title="No eligible rating data." message="Submitted evaluations do not yet contain reportable Section ratings." />}
          <div className="reports-table-row reports-table-head reports-groups-row"><span>Group</span><span>Employees</span><span title="Completed evaluations / assigned evaluations">Evaluations</span><span>Completion rate</span><span>Average score</span><span>Actions</span></div>
           {groups.map((group) => <div className="reports-table-row reports-groups-row" key={group.group_id}><strong>{group.group_name}</strong><span className="reports-number-cell">{group.employee_count}</span><span className="reports-number-cell">{group.completed_evaluations} / {group.total_evaluations}</span><span className="reports-number-cell">{formatPercent(group.completion_rate)}</span><span className="reports-number-cell" title={group.average_score_context}>{group.average_score === null && group.score_availability === 'suppressed' ? 'Suppressed' : formatScore(group.average_score)}</span><span className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/groups/${group.group_id}`}>Details</Link></span></div>)}
        </>}
    </section>
  </>;
}

export function GroupDetailPage() {
  const { campaignId, groupId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const selectedGroupId = Number(groupId);
  const teamOnly = useTeamReportsOnly();
  if (!teamOnly && Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0) return <Navigate to={`/reports/campaigns/${selectedCampaignId}${Number.isSafeInteger(selectedGroupId) && selectedGroupId > 0 ? `?groups=${selectedGroupId}` : ''}`} replace />;
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(selectedCampaignId) ? selectedCampaignId : null}>{({ getAccessToken }) => <GroupDetailContent campaignId={selectedCampaignId} groupId={selectedGroupId} getAccessToken={getAccessToken} />}</ReportsLayout>;
}

function GroupDetailContent({ campaignId, groupId, getAccessToken }: { campaignId: number; groupId: number; getAccessToken: AccessTokenGetter | undefined }) {
  const [data, setData] = useState<GroupReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const teamOnly = useTeamReportsOnly();

  useEffect(() => {
    if (!getAccessToken) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchGroupReportDetail(getAccessToken, campaignId, groupId, controller.signal)
       .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Group report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, groupId, getAccessToken, reload]);

  if (data === null || data.campaign.id !== campaignId || data.group.id !== groupId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
   return <div className="reports-overview"><Link className="campaign-details-link" to={`/reports/campaigns/${campaignId}/groups`}>← Back to Groups</Link><header className="reports-detail-heading"><h2>{data.group.name}</h2><p>{data.campaign.name} · Group analysis</p>{data.group.description && <p>{data.group.description}</p>}</header><ReportKpis items={[{ label: 'Employees', value: data.kpis.employees }, { label: 'Completed evaluations', value: data.kpis.completed_evaluations }, { label: 'Completion rate', value: formatPercent(data.kpis.completion_rate) }, { label: 'Reportable sections', value: data.kpis.reportable_sections, context: `Overall peer score: ${data.kpis.overall_peer_score === null ? 'Unavailable' : `${formatScore(data.kpis.overall_peer_score)} / 5`}` }]} />{getAccessToken && <EmployeeAIAnalysisPanel scope={{ type: 'group', campaignId, groupId }} getAccessToken={getAccessToken} />}<div className="reports-chart-grid reports-chart-grid-single"><SectionScoresChart sections={data.sections} /></div>{!teamOnly && <Link className="campaign-details-link" to={`/reports/campaigns/${campaignId}/questions?group_id=${groupId}`}>Explore group questions →</Link>}<SimpleTable title="Roles in this group" emptyTitle="No role coverage yet." emptyMessage="No employees with company roles are available for this group." columns={['Company role', 'Employees', 'Completed received', 'Reportable average']} rows={data.roles.map((role) => [role.role_name, role.employee_count, role.completed_evaluations_received, reportableScore(role.average_score, role.score_availability)])} /><SimpleTable title="Group employee coverage" emptyTitle="No employee coverage available." emptyMessage="This group has no campaign participants to summarize." columns={['Employee', 'Role', 'Reviews received', 'Self-evaluation', 'Peer rating']} rows={data.employees.map((employee) => [employee.employee_name, employee.role_name, employee.reviews_assigned != null ? `${employee.reviews_received} / ${employee.reviews_assigned}` : employee.reviews_received, employee.completed_self_evaluation ? 'Completed' : 'Not completed', employee.peer_score != null ? employee.peer_score.toFixed(2) : employee.score_availability === 'suppressed' ? 'Hidden' : '–'])} /></div>;
}

function SimpleTable({ title, emptyTitle, emptyMessage, columns, rows }: { title: string; emptyTitle: string; emptyMessage: string; columns: string[]; rows: Array<Array<string | number>> }) {
  return <section className="reports-card reports-simple-table"><div className="reports-section-heading"><h2>{title}</h2></div>{rows.length === 0 ? <ReportsEmptyState title={emptyTitle} message={emptyMessage} /> : <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>}</section>;
}

/** Role reports moved to the Overview's Roles view; old links open it with the role selected. */
export function RoleDetailPage() {
  const { campaignId, roleId } = useParams();
  const id = Number(roleId);
  return <Navigate to={`/reports/campaigns/${campaignId}?by=roles${Number.isSafeInteger(id) && id > 0 ? `&roles=${id}` : ''}`} replace />;
}
