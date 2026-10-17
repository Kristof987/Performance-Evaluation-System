import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { fetchGroupReportDetail, fetchGroupsReport, fetchRoleReportDetail, fetchRolesReport } from './api/reports.api';
import ReportsEmptyState from './components/ReportsEmptyState';
import SectionScoresChart from './components/SectionScoresChart';
import QuestionAnalytics from './components/QuestionAnalytics';
import ReportsLayout from './ReportsLayout';
import type { GroupReportDetail, GroupsReport, RolePerspective, RoleReportDetail, RolesReport } from './types/reports.types';

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
    return <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={retry}>Retry</button></div>;
  }
  return <div className="reports-state">Loading report analytics...</div>;
}

function ReportKpis({ items }: { items: Array<{ label: string; value: string | number; context?: string }> }) {
  return <section className="reports-kpi-panel reports-kpi-panel-compact">{items.map((item, index) => <div className={index === 0 ? 'reports-kpi-segment reports-kpi-primary' : 'reports-kpi-segment'} key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.context && <small>{item.context}</small>}</div>)}</section>;
}

function GroupsRolesTabs({ campaignId, view }: { campaignId: number; view: 'groups' | 'roles' }) {
  const navigate = useNavigate();
  return <div className="reports-segmented" role="tablist" aria-label="Groups and roles reports"><button className={view === 'groups' ? 'active' : ''} type="button" onClick={() => navigate(`/reports/campaigns/${campaignId}/groups`)}>Groups</button><button className={view === 'roles' ? 'active' : ''} type="button" onClick={() => navigate(`/reports/campaigns/${campaignId}/roles`)}>Roles</button></div>;
}

export function GroupsRolesPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;
  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{(layout) => <GroupsRolesContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layout} />}</ReportsLayout>;
}

function GroupsRolesContent({ selectedCampaignId, validCampaignId, requesterUserId, loadingCampaigns, campaignsError, campaigns, retryCampaigns }: { selectedCampaignId: number; validCampaignId: boolean; requesterUserId: number | null; loadingCampaigns: boolean; campaignsError: string; campaigns: Array<{ id: number }>; retryCampaigns: () => void }) {
  const location = useLocation();
  const view = location.pathname.includes('/roles') ? 'roles' : 'groups';
  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
  if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  return <div className="reports-overview"><GroupsRolesTabs campaignId={selectedCampaignId} view={view} />{view === 'groups' ? <GroupsOverview campaignId={selectedCampaignId} requesterUserId={requesterUserId} /> : <RolesOverview campaignId={selectedCampaignId} requesterUserId={requesterUserId} />}</div>;
}

function GroupsOverview({ campaignId, requesterUserId }: { campaignId: number; requesterUserId: number | null }) {
  const [data, setData] = useState<GroupsReport | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchGroupsReport(campaignId, requesterUserId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Group reports could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, requesterUserId, reload]);

  const groups = useMemo(() => (data?.groups ?? []).filter((group) => group.group_name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => a.group_name.localeCompare(b.group_name)), [data, query]);
  if (data === null || data.campaign.id !== campaignId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;

  const hasCompleted = data.groups.some((group) => group.completed_evaluations > 0);
  const hasScores = data.groups.some((group) => group.average_score !== null);

  return <>
    <ReportKpis items={[{ label: 'Groups in campaign', value: data.kpis.groups_in_campaign }, { label: 'Participating employees', value: data.kpis.participating_employees, context: 'Deduplicated across groups' }, { label: 'Completed evaluations', value: data.kpis.completed_evaluations }, { label: 'Groups with reportable results', value: data.kpis.groups_with_reportable_results, context: 'Sufficient comparable data' }]} />
    <section className="reports-card reports-table reports-wide-card">
      <div className="reports-section-heading reports-section-heading-row"><div><h2>Group comparison</h2><p>Assignment-attributed evaluations. Evaluations show completed / total.</p></div><input className="form-control reports-search" placeholder="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      {data.groups.length === 0 ? <ReportsEmptyState title="No groups assigned to this campaign." message="Assign company groups to this campaign before group analytics can be shown." />
        : groups.length === 0 ? <ReportsEmptyState title="No groups found." message="No campaign groups match the current search." />
        : <>
          {!hasCompleted && <ReportsEmptyState title="No completed evaluations yet." message="Group scores will appear when sufficient submitted results are available." />}
          {hasCompleted && !hasScores && <ReportsEmptyState title="Scores are not available yet." message="Results are hidden until there is enough comparable rating data to report safely." />}
          <div className="reports-table-row reports-table-head reports-groups-row"><span>Group</span><span>Employees</span><span title="Completed evaluations / assigned evaluations">Evaluations</span><span>Completion rate</span><span>Average score</span><span>Actions</span></div>
           {groups.map((group) => <div className="reports-table-row reports-groups-row" key={group.group_id}><strong>{group.group_name}</strong><span className="reports-number-cell">{group.employee_count}</span><span className="reports-number-cell">{group.completed_evaluations} / {group.total_evaluations}</span><span className="reports-number-cell">{formatPercent(group.completion_rate)}</span><span className="reports-number-cell" title={group.average_score_context}>{group.average_score === null && group.score_availability === 'suppressed' ? 'Suppressed' : formatScore(group.average_score)}</span><span className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/groups/${group.group_id}`}>Details</Link></span></div>)}
        </>}
    </section>
  </>;
}

function RolesOverview({ campaignId, requesterUserId }: { campaignId: number; requesterUserId: number | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const perspective = searchParams.get('perspective') === 'evaluator' ? 'evaluator' : 'evaluatee';
  const [data, setData] = useState<RolesReport | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchRolesReport(campaignId, requesterUserId, perspective, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Role reports could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, perspective, requesterUserId, reload]);

  function changePerspective(value: RolePerspective) {
    navigate(`/reports/campaigns/${campaignId}/roles?perspective=${value}`);
  }

  if (data === null || data.campaign.id !== campaignId || data.perspective !== perspective) return <><RoleHeader perspective={perspective} onChange={changePerspective} /><LoadingOrError error={error} retry={() => setReload((value) => value + 1)} /></>;

  return <>
    <RoleHeader perspective={perspective} onChange={changePerspective} />
    <ReportKpis items={[{ label: 'Roles in analysis', value: data.kpis.roles_in_campaign }, { label: perspective === 'evaluator' ? 'Assigned evaluators' : 'Employees to evaluate', value: data.kpis.participating_employees, context: perspective === 'evaluator' ? 'Unique evaluators with assigned reviews' : 'Unique evaluatees with assigned reviews' }, { label: 'Completed evaluations', value: data.kpis.completed_evaluations }, { label: 'Roles with reportable results', value: data.kpis.roles_with_reportable_results }]} />
     {data.section_comparison && <section className="reports-card reports-wide-card"><div className="reports-section-heading"><h2>{data.section_comparison.section_name} by role</h2><p>Normalized scores on a common 1–5 scale. Only roles meeting privacy thresholds for this section are shown.</p></div><div className="reports-dimension-chart" role="list">{data.section_comparison.roles.map((role) => <div className="reports-bar-row" role="listitem" key={role.role_id}><div className="reports-bar-label"><strong>{role.role_name}</strong><span>{role.evaluatee_count} employees · {role.evaluator_count} peer evaluators · 1–5 scale</span></div><div className="reports-bar-track" aria-label={`${role.role_name}: ${role.average_score.toFixed(2)} out of 5`}><span style={{ width: `${Math.min(100, (role.average_score / 5) * 100)}%` }} /></div><strong className="reports-bar-value">{role.average_score.toFixed(2)}</strong></div>)}</div></section>}
      <section className="reports-card reports-table reports-wide-card"><div className="reports-section-heading"><h2>Role comparison</h2><p>{perspective === 'evaluatee' ? 'Average ratings received by employees in each company role.' : 'Average ratings given by employees in each company role. This is not a measure of evaluator performance.'}</p></div>{data.roles.length === 0 ? <ReportsEmptyState title="No role data available." message="Role comparison will appear after evaluations are assigned for this campaign." /> : <><div className="reports-table-row reports-table-head reports-roles-row"><span>Role</span><span>Employees</span><span>Completed evaluations</span><span>Sections</span><span>Average score</span><span>Actions</span></div>{data.roles.map((role) => <div className="reports-table-row reports-roles-row" key={role.role_id}><strong>{role.role_name}</strong><span className="reports-number-cell">{role.employee_count}</span><span className="reports-number-cell">{role.completed_evaluations}</span><span className="reports-number-cell">{role.available_sections}</span><span className="reports-number-cell" title={role.average_score_context}>{reportableScore(role.average_score, role.score_availability)}</span><span className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/roles/${role.role_id}?perspective=${perspective}`}>Details</Link></span></div>)}</>}</section>
  </>;
}

function RoleHeader({ perspective, onChange }: { perspective: RolePerspective; onChange: (value: RolePerspective) => void }) {
  return <section className="reports-role-header"><div><h2>Role comparison</h2><p>{perspective === 'evaluatee' ? 'Average ratings received by employees in each company role.' : 'Average ratings given by employees in each company role.'}</p></div><select className="form-control reports-role-select" value={perspective} onChange={(event) => onChange(event.target.value as RolePerspective)} aria-label="Role analysis perspective"><option value="evaluatee">Evaluated role</option><option value="evaluator">Evaluator role</option></select></section>;
}

export function GroupDetailPage() {
  const { campaignId, groupId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const selectedGroupId = Number(groupId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(selectedCampaignId) ? selectedCampaignId : null}>{({ requesterUserId }) => <GroupDetailContent campaignId={selectedCampaignId} groupId={selectedGroupId} requesterUserId={requesterUserId} />}</ReportsLayout>;
}

function GroupDetailContent({ campaignId, groupId, requesterUserId }: { campaignId: number; groupId: number; requesterUserId: number | null }) {
  const [data, setData] = useState<GroupReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchGroupReportDetail(campaignId, groupId, requesterUserId, controller.signal)
       .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Group report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, groupId, requesterUserId, reload]);

  if (data === null || data.campaign.id !== campaignId || data.group.id !== groupId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
   return <div className="reports-overview"><Link className="campaign-details-link" to={`/reports/campaigns/${campaignId}/groups`}>← Back to Groups & Roles</Link><header className="reports-detail-heading"><h2>{data.group.name}</h2><p>{data.campaign.name} · Group analysis</p>{data.group.description && <p>{data.group.description}</p>}</header><ReportKpis items={[{ label: 'Employees', value: data.kpis.employees }, { label: 'Completed evaluations', value: data.kpis.completed_evaluations }, { label: 'Completion rate', value: formatPercent(data.kpis.completion_rate) }, { label: 'Reportable sections', value: data.kpis.reportable_sections, context: `Overall peer score: ${data.kpis.overall_peer_score === null ? 'Unavailable' : `${formatScore(data.kpis.overall_peer_score)} / 5`}` }]} /><div className="reports-chart-grid reports-chart-grid-single"><SectionScoresChart sections={data.sections} /></div><QuestionAnalytics campaignId={campaignId} requesterUserId={requesterUserId} scope={{ group_id: groupId }} /><SimpleTable title="Roles in this group" emptyTitle="No role coverage yet." emptyMessage="No employees with company roles are available for this group." columns={['Company role', 'Employees', 'Completed received', 'Reportable average']} rows={data.roles.map((role) => [role.role_name, role.employee_count, role.completed_evaluations_received, reportableScore(role.average_score, role.score_availability)])} /><SimpleTable title="Group employee coverage" emptyTitle="No employee coverage available." emptyMessage="This group has no campaign participants to summarize." columns={['Employee', 'Role', 'Reviews received', 'Self-evaluation', 'Feedback availability']} rows={data.employees.map((employee) => [employee.employee_name, employee.role_name, employee.reviews_received, employee.completed_self_evaluation ? 'Completed' : 'Not completed', employee.feedback_availability])} /></div>;
}

export function RoleDetailPage() {
  const { campaignId, roleId } = useParams();
  const [searchParams] = useSearchParams();
  const perspective = searchParams.get('perspective') === 'evaluator' ? 'evaluator' : 'evaluatee';
  const selectedCampaignId = Number(campaignId);
  const selectedRoleId = Number(roleId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(selectedCampaignId) ? selectedCampaignId : null}>{({ requesterUserId }) => <RoleDetailContent campaignId={selectedCampaignId} roleId={selectedRoleId} requesterUserId={requesterUserId} perspective={perspective} />}</ReportsLayout>;
}

function RoleDetailContent({ campaignId, roleId, requesterUserId, perspective }: { campaignId: number; roleId: number; requesterUserId: number | null; perspective: RolePerspective }) {
  const navigate = useNavigate();
  const [data, setData] = useState<RoleReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchRoleReportDetail(campaignId, roleId, requesterUserId, perspective, controller.signal)
       .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Role report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, perspective, requesterUserId, roleId, reload]);

  if (data === null || data.campaign.id !== campaignId || data.role.id !== roleId || data.perspective !== perspective) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
   return <div className="reports-overview"><button className="campaign-details-link link-button" type="button" onClick={() => navigate(`/reports/campaigns/${campaignId}/roles?perspective=${perspective}`)}>← Back to Roles</button><header className="reports-detail-heading"><h2>{data.role.name}</h2><p>{data.campaign.name} · {perspective === 'evaluator' ? 'Evaluator role' : 'Evaluated role'}</p></header><ReportKpis items={[{ label: perspective === 'evaluator' ? 'Assigned evaluators' : 'Employees to evaluate', value: data.kpis.employees }, { label: perspective === 'evaluator' ? 'Completed reviews submitted' : 'Completed reviews received', value: data.kpis.completed_evaluations }, { label: 'Reportable sections', value: data.kpis.reportable_sections }, { label: perspective === 'evaluator' ? 'Average rating given' : 'Overall section score', value: formatScore(data.kpis.overall_score) }]} /><div className="reports-chart-grid reports-chart-grid-single"><SectionScoresChart sections={data.sections} /></div><QuestionAnalytics campaignId={campaignId} requesterUserId={requesterUserId} scope={{ role_id: roleId, perspective }} /><SimpleTable title="Group breakdown" emptyTitle="No group breakdown available." emptyMessage="This role has no campaign group coverage for the selected perspective." columns={['Group', 'Employees', 'Completed evaluations', 'Reportable average']} rows={data.groups.map((group) => [group.group_name, group.employee_count, group.completed_evaluations, reportableScore(group.average_score, group.score_availability)])} /><section className="reports-card"><div className="reports-section-heading"><h2>Evaluation coverage</h2><p>{data.coverage.completed_evaluations} of {data.coverage.assigned_evaluations} role-scoped evaluations completed.</p></div></section></div>;
}

function SimpleTable({ title, emptyTitle, emptyMessage, columns, rows }: { title: string; emptyTitle: string; emptyMessage: string; columns: string[]; rows: Array<Array<string | number>> }) {
  return <section className="reports-card reports-simple-table"><div className="reports-section-heading"><h2>{title}</h2></div>{rows.length === 0 ? <ReportsEmptyState title={emptyTitle} message={emptyMessage} /> : <table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>}</section>;
}
