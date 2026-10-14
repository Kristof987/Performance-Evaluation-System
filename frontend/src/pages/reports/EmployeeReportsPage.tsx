import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fetchEmployeeReportDetail, fetchEmployeeReportsOverview } from './api/reports.api';
import EmployeeReportDetailView from './EmployeeReportDetailView';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import type { EmployeeReportDetail, EmployeeReportRow, EmployeeReportsOverview } from './types/reports.types';

function formatScore(value: number | null, scaleMax?: number | null) {
  if (value === null) return '—';
  return scaleMax ? `${value.toFixed(2)} / ${scaleMax}` : value.toFixed(2);
}

function LoadingOrError({ error, retry }: { error: string; retry: () => void }) {
  if (error) return <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={retry}>Retry</button></div>;
  return <div className="reports-state">Loading employee analytics...</div>;
}

function ReportKpis({ items }: { items: Array<{ label: string; value: string | number; context?: string }> }) {
  return <section className="reports-kpi-panel reports-kpi-panel-compact">{items.map((item, index) => <div className={index === 0 ? 'reports-kpi-segment reports-kpi-primary' : 'reports-kpi-segment'} key={item.label}><span>{item.label}</span><strong>{item.value}</strong>{item.context && <small>{item.context}</small>}</div>)}</section>;
}

export function EmployeeReportsPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;
  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{(layout) => <EmployeeReportsContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layout} />}</ReportsLayout>;
}

function EmployeeReportsContent({ selectedCampaignId, validCampaignId, requesterUserId, loadingCampaigns, campaignsError, campaigns, retryCampaigns }: { selectedCampaignId: number; validCampaignId: boolean; requesterUserId: number | null; loadingCampaigns: boolean; campaignsError: string; campaigns: Array<{ id: number }>; retryCampaigns: () => void }) {
  const [data, setData] = useState<EmployeeReportsOverview | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [group, setGroup] = useState('all');
  const [sort, setSort] = useState('name');

  useEffect(() => {
    if (!validCampaignId || requesterUserId === null) return undefined;
    const controller = new AbortController();
    fetchEmployeeReportsOverview(selectedCampaignId, requesterUserId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee reports could not be loaded.'); });
    return () => controller.abort();
  }, [requesterUserId, reload, selectedCampaignId, validCampaignId]);

  const roleOptions = useMemo(() => Array.from(new Set((data?.employees ?? []).map((employee) => employee.company_role))).sort(), [data]);
  const groupOptions = useMemo(() => Array.from(new Set((data?.employees ?? []).flatMap((employee) => employee.groups))).sort(), [data]);
  const employees = useMemo(() => {
    const filtered = (data?.employees ?? []).filter((employee) => {
      const matchesQuery = `${employee.employee_name} ${employee.email}`.toLowerCase().includes(query.toLowerCase());
      const matchesRole = role === 'all' || employee.company_role === role;
      const matchesGroup = group === 'all' || employee.groups.includes(group);
      return matchesQuery && matchesRole && matchesGroup;
    });
    return filtered.sort((a, b) => sort === 'feedback'
      ? (b.peer_completed / Math.max(1, b.peer_assigned)) - (a.peer_completed / Math.max(1, a.peer_assigned)) || a.employee_name.localeCompare(b.employee_name)
      : a.employee_name.localeCompare(b.employee_name));
  }, [data, group, query, role, sort]);

  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
  if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  if (data === null) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;

  return <div className="reports-overview">
    <ReportKpis items={[{ label: 'Participating employees', value: data.kpis.participating_employees }, { label: 'Employees with peer feedback', value: data.kpis.employees_with_peer_feedback }, { label: 'Awaiting peer feedback', value: data.kpis.awaiting_peer_feedback }, { label: 'Self-evaluations completed', value: `${data.kpis.completed_self_evaluations}/${data.kpis.assigned_self_evaluations}`, context: 'assigned' }]} />
    <section className="reports-card reports-table reports-wide-card">
      <div className="reports-section-heading"><h2>Employees</h2><p>Coverage and reportable summaries for employees in this campaign.</p><div className="reports-filter-row"><input className="form-control reports-search" placeholder="Search employees" aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="form-control" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by company role"><option value="all">All roles</option>{roleOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="form-control" value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter by group"><option value="all">All groups</option>{groupOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="form-control" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort employees"><option value="name">Sort by name</option><option value="feedback">Sort by feedback completion</option></select></div></div>
      {data.employees.length === 0 ? <ReportsEmptyState title="No employees in this campaign." message="Employee analytics will appear after people are assigned to campaign groups or evaluations." />
        : employees.length === 0 ? <ReportsEmptyState title="No employees match the filters." message="Adjust search, role or group filters to view employees." />
          : <><div className="reports-table-row reports-table-head reports-employees-row"><span>Employee</span><span>Company role</span><span>Groups</span><span>Peer reviews completed</span><span>Self-evaluation</span><span>Summary</span><span>Actions</span></div>{employees.map((employee) => <EmployeeRow employee={employee} campaignId={selectedCampaignId} key={employee.employee_id} />)}</>}
    </section>
  </div>;
}

function EmployeeRow({ employee, campaignId }: { employee: EmployeeReportRow; campaignId: number }) {
  const summary = employee.performance_summary.suppressed ? 'Insufficient feedback' : employee.performance_summary.average_score !== null ? formatScore(employee.performance_summary.average_score, employee.performance_summary.scale_max) : employee.peer_completed === 0 ? 'Not yet available' : 'No comparable scores';
  return <div className="reports-table-row reports-employees-row"><div className="reports-person-cell"><strong>{employee.employee_name}</strong><small>{employee.email}</small></div><span>{employee.company_role}</span><span className="reports-groups-cell" title={employee.groups.join(', ')}>{employee.groups.length > 0 ? employee.groups.join(', ') : '—'}</span><span className="reports-number-cell" aria-label={`${employee.peer_completed} of ${employee.peer_assigned} incoming peer reviews completed`}>{employee.peer_completed} / {employee.peer_assigned}</span><span>{employee.self_evaluation.status}</span><span className="reports-number-cell" title={employee.performance_summary.suppressed ? 'Individual score is withheld to protect confidentiality.' : undefined}>{summary}</span><span className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/employees/${employee.employee_id}`}>View details</Link></span></div>;
}

export function EmployeeReportDetailPage() {
  const { campaignId, employeeId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const selectedEmployeeId = Number(employeeId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(selectedCampaignId) ? selectedCampaignId : null}>{({ requesterUserId }) => <EmployeeReportDetailContent campaignId={selectedCampaignId} employeeId={selectedEmployeeId} requesterUserId={requesterUserId} />}</ReportsLayout>;
}

function EmployeeReportDetailContent({ campaignId, employeeId, requesterUserId }: { campaignId: number; employeeId: number; requesterUserId: number | null }) {
  const navigate = useNavigate();
  const [data, setData] = useState<EmployeeReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (requesterUserId === null) return undefined;
    const controller = new AbortController();
    fetchEmployeeReportDetail(campaignId, employeeId, requesterUserId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, requesterUserId, reload]);

  if (data === null) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
  return <EmployeeReportDetailView data={data} selectedHistory={data.history[0] ?? null} onBack={() => navigate(`/reports/campaigns/${campaignId}/employees`)} />;
}
