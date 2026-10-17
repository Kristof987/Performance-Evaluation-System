import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { fetchEmployeeReportDetail, fetchEmployeeReportsOverview } from './api/reports.api';
import EmployeeReportDetailView from './EmployeeReportDetailView';
import EmployeeOverview from './components/EmployeeOverview';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import type { EmployeeReportDetail, EmployeeReportRow, EmployeeReportsOverview } from './types/reports.types';

function formatScore(value: number | null) {
  if (value === null) return '—';
  return `${value.toFixed(2)} / 5`;
}

function LoadingOrError({ error, retry }: { error: string; retry: () => void }) {
  if (error) return <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={retry}>Retry</button></div>;
  return <div className="reports-state">Loading employee analytics...</div>;
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
    setData(null);
    setError('');
    fetchEmployeeReportsOverview(selectedCampaignId, requesterUserId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee reports could not be loaded.'); });
    return () => controller.abort();
  }, [requesterUserId, reload, selectedCampaignId, validCampaignId]);

  const roleOptions = useMemo(() => Array.from(new Set((data?.employees ?? []).map((employee) => employee.company_role))).sort(), [data]);
  const groupOptions = useMemo(() => Array.from(new Set((data?.employees ?? []).flatMap((employee) => employee.groups))).sort(), [data]);
  const employees = useMemo(() => {
    const filtered = (data?.employees ?? []).filter((employee) => {
      const matchesQuery = `${employee.employee_name} ${employee.email ?? ''}`.toLowerCase().includes(query.toLowerCase());
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
  if (data === null || data.campaign.id !== selectedCampaignId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;

  return <div className="reports-overview">
    <EmployeeOverview employees={{ participating_employees: data.kpis.participating_employees, employees_with_completed_peer_feedback: data.kpis.employees_with_peer_feedback, employees_awaiting_peer_feedback: data.kpis.awaiting_peer_feedback, configured_self_evaluations: data.kpis.assigned_self_evaluations, completed_self_evaluations: data.kpis.completed_self_evaluations }} />
    <section className="reports-card reports-table reports-wide-card">
      <div className="reports-section-heading"><h2>Employees</h2><p>Coverage and reportable summaries for employees in this campaign.</p><div className="reports-filter-row"><input className="form-control reports-search" placeholder="Search employees" aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} /><select className="form-control" value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by company role"><option value="all">All roles</option>{roleOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="form-control" value={group} onChange={(event) => setGroup(event.target.value)} aria-label="Filter by group"><option value="all">All groups</option>{groupOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="form-control" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort employees"><option value="name">Sort by name</option><option value="feedback">Sort by feedback completion</option></select></div></div>
      {data.employees.length === 0 ? <ReportsEmptyState title="No employees in this campaign." message="Employee analytics will appear after people are assigned to campaign groups or evaluations." />
        : employees.length === 0 ? <ReportsEmptyState title="No employees match the filters." message="Adjust search, role or group filters to view employees." />
          : <><div className="reports-table-row reports-table-head reports-employees-row"><span>Employee</span><span>Company role</span><span>Groups</span><span>Peer reviews completed</span><span>Self-evaluation</span><span>Peer score</span><span>Actions</span></div>{employees.map((employee) => <EmployeeRow employee={employee} campaignId={selectedCampaignId} key={employee.employee_id} />)}</>}
    </section>
  </div>;
}

function EmployeeRow({ employee, campaignId }: { employee: EmployeeReportRow; campaignId: number }) {
  const { availability, overall_peer_score, reportable_sections } = employee.performance_summary;
  const summary = availability === 'suppressed' ? 'Insufficient feedback' : availability === 'available' && overall_peer_score !== null ? formatScore(overall_peer_score) : 'Not yet available';
  return <div className="reports-table-row reports-employees-row"><div className="reports-person-cell"><strong>{employee.employee_name}</strong><small>{employee.email}</small></div><span>{employee.company_role}</span><span className="reports-groups-cell" title={employee.groups.join(', ')}>{employee.groups.length > 0 ? employee.groups.join(', ') : '—'}</span><span className="reports-number-cell" aria-label={`${employee.peer_completed} of ${employee.peer_assigned} incoming peer reviews completed`}>{employee.peer_completed} / {employee.peer_assigned}</span><span>{employee.self_evaluation.status}</span><span className="reports-number-cell reports-peer-score" title={availability === 'suppressed' ? 'Individual score is withheld to protect confidentiality.' : undefined}><strong>{summary}</strong>{availability === 'available' && <small>{reportable_sections} {reportable_sections === 1 ? 'section' : 'sections'}</small>}</span><span className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/employees/${employee.employee_id}`}>View details</Link></span></div>;
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
    setData(null);
    setError('');
    fetchEmployeeReportDetail(campaignId, employeeId, requesterUserId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, requesterUserId, reload]);

  if (data === null || data.campaign.id !== campaignId || data.employee.id !== employeeId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
  return <EmployeeReportDetailView data={data} onBack={() => navigate(`/reports/campaigns/${campaignId}/employees`)} />;
}
