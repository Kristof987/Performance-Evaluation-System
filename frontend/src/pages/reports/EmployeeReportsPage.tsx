import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { fetchEmployeeReportDetail, fetchEmployeeReportsOverview } from './api/reports.api';
import EmployeeReportDetailView from './EmployeeReportDetailView';
import EmployeeOverview from './components/EmployeeOverview';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import WrittenFeedbackPreview from './components/WrittenFeedbackPreview';
import type { EmployeeReportDetail, EmployeeReportRow, EmployeeReportsOverview } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { usePageTitle } from '../../app/usePageTitle';
import LoadError from '../../components/feedback/LoadError';
import LoadingState from '../../components/feedback/LoadingState';
import { GroupToggles } from './components/ReportFilterBar';
import { ChartCard, CsvButton, Delta, SelfPeerScatter, type ScatterPoint } from './charts/DashboardCharts';
import { csvScore } from './reportExport';
import { scoreColor, seriesColor, useChartTheme, type ChartTheme } from './charts/chartTheme';

function LoadingOrError({ error, retry }: { error: string; retry: () => void }) {
  if (error) return <LoadError message={error} onRetry={retry} />;
  return <LoadingState variant="page" label="Loading employee report" />;
}

export function EmployeeReportsPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;
  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null} allowWrittenFeedbackPreview>{(layout) => {
    const campaign = layout.campaigns.find((item) => item.id === selectedCampaignId);
    if (layout.getAccessToken && (campaign?.campaign_status === 'active' || campaign?.campaign_status === 'paused')) {
      return <WrittenFeedbackPreview key={selectedCampaignId} campaignId={selectedCampaignId} targetList getAccessToken={layout.getAccessToken} />;
    }
    return <EmployeeReportsContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layout} />;
  }}</ReportsLayout>;
}

type EmployeeSort = 'name' | 'score-high' | 'score-low' | 'change' | 'feedback' | 'gap' | `section:${number}`;

const SORTS: Array<{ value: EmployeeSort; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'score-high', label: 'Highest peer rating' },
  { value: 'score-low', label: 'Lowest peer rating' },
  { value: 'change', label: 'Biggest drop first' },
  { value: 'gap', label: 'Largest self − peer gap' },
  { value: 'feedback', label: 'Feedback completion' },
];

const peerScore = (employee: EmployeeReportRow) => employee.performance_summary.availability === 'available' ? employee.performance_summary.overall_peer_score : null;

function sortValue(employee: EmployeeReportRow, sort: EmployeeSort) {
  const score = peerScore(employee);
  const previous = employee.performance_summary.previous_overall_peer_score;
  const self = employee.performance_summary.overall_self_score;
  if (sort.startsWith('section:')) return employee.performance_summary.section_scores[sort.slice(8)] ?? Infinity;
  switch (sort) {
    case 'score-high': return score === null ? Infinity : -score;
    case 'score-low': return score ?? Infinity;
    case 'change': return score === null || previous === null ? Infinity : score - previous;
    case 'gap': return score === null || self === null ? Infinity : -Math.abs(self - score);
    case 'feedback': return -(employee.peer_completed / Math.max(1, employee.peer_assigned));
    default: return 0;
  }
}

function employeeRows(data: EmployeeReportsOverview, employees: EmployeeReportRow[]) {
  return [
    ['Employee', 'Email', 'Role', 'Groups', 'Peer rating', data.previous_campaign ? `Previous (${data.previous_campaign.name})` : 'Previous', 'Self rating', 'Peer reviews completed', 'Peer reviews assigned', ...data.sections.map((section) => section.name)],
    ...employees.map((employee) => {
      const summary = employee.performance_summary;
      return [employee.employee_name, employee.email, employee.company_role, employee.groups.join('; '), csvScore(summary.overall_peer_score, summary.availability),
        csvScore(summary.previous_overall_peer_score), csvScore(summary.overall_self_score), employee.peer_completed, employee.peer_assigned,
        ...data.sections.map((section) => csvScore(summary.section_scores[String(section.id)]))];
    }),
  ];
}

function EmployeeReportsContent({ selectedCampaignId, validCampaignId, getAccessToken, loadingCampaigns, campaignsError, campaigns, retryCampaigns }: { selectedCampaignId: number; validCampaignId: boolean; getAccessToken: AccessTokenGetter | undefined; loadingCampaigns: boolean; campaignsError: string; campaigns: Array<{ id: number }>; retryCampaigns: () => void }) {
  const [data, setData] = useState<EmployeeReportsOverview | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  // The dashboard links here with ?groups=…&section=…, to see who is behind a group or section score.
  const [params] = useSearchParams();
  const linkedGroups = (params.get('groups') ?? '').split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
  const linkedSection = Number(params.get('section'));
  const [groupIds, setGroupIds] = useState<number[]>(linkedGroups);
  const [sort, setSort] = useState<EmployeeSort>(linkedSection > 0 ? `section:${linkedSection}` : 'name');
  const theme = useChartTheme();
  const navigate = useNavigate();

  useEffect(() => {
    if (!validCampaignId || !getAccessToken) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchEmployeeReportsOverview(getAccessToken, selectedCampaignId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setGroupIds((ids) => ids.filter((id) => result.groups.some((group) => group.id === id)));
        setSort((value) => value.startsWith('section:') && !result.sections.some((section) => `section:${section.id}` === value) ? 'name' : value);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee reports could not be loaded.'); });
    return () => controller.abort();
  }, [getAccessToken, reload, selectedCampaignId, validCampaignId]);

  const roleOptions = useMemo(() => Array.from(new Set((data?.employees ?? []).map((employee) => employee.company_role))).sort(), [data]);
  const colorOf = useMemo(() => {
    const index = new Map((data?.groups ?? []).map((group, position) => [group.id, position]));
    return (id: number) => seriesColor(theme, index.get(id) ?? 0);
  }, [data, theme]);
  const employees = useMemo(() => {
    const filtered = (data?.employees ?? []).filter((employee) => {
      const matchesQuery = `${employee.employee_name} ${employee.email ?? ''}`.toLowerCase().includes(query.toLowerCase());
      const matchesRole = role === 'all' || employee.company_role === role;
      const matchesGroup = groupIds.length === 0 || employee.group_ids.some((id) => groupIds.includes(id));
      return matchesQuery && matchesRole && matchesGroup;
    });
    return filtered.sort((a, b) => sortValue(a, sort) - sortValue(b, sort) || a.employee_name.localeCompare(b.employee_name));
  }, [data, groupIds, query, role, sort]);

  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <LoadingState variant="page" label="Loading campaigns" />;
  if (campaignsError) return <LoadError message={campaignsError} onRetry={retryCampaigns} />;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  if (data === null || data.campaign.id !== selectedCampaignId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;

  const scatter: ScatterPoint[] = employees.flatMap((employee) => {
    const peer = peerScore(employee);
    const self = employee.performance_summary.overall_self_score;
    return peer !== null && self !== null ? [{ id: employee.employee_id, name: employee.employee_name, peer, self, color: employee.group_ids.length ? colorOf(employee.group_ids[0]) : theme.textMuted }] : [];
  });
  const higherSelf = scatter.filter((point) => point.self - point.peer > 0.05).length;
  const lowerSelf = scatter.filter((point) => point.peer - point.self > 0.05).length;

  return <div className="reports-overview reports-employees-page">
    <EmployeeOverview report={data} />
    <div className="reports-scope-row reports-employee-scope">
      <GroupToggles groups={data.groups} selected={groupIds} colorOf={colorOf} onChange={setGroupIds} />
    </div>
    {scatter.length >= 3 && <ChartCard title="Self rating vs. peer rating" subtitle={`One dot per employee, coloured by group · above the line = rates themself higher (${higherSelf}) · below = lower (${lowerSelf}) · click a dot to open`}>
      <SelfPeerScatter theme={theme} points={scatter} onSelect={(id) => navigate(`/reports/campaigns/${selectedCampaignId}/employees/${id}`)} />
    </ChartCard>}
    <section className="reports-card reports-simple-table reports-employee-table">
      <div className="reports-section-heading reports-heading-with-action"><h2>Employees</h2><CsvButton name={`${data.campaign.name} employees`} rows={() => employeeRows(data, employees)} /><p>Peer rating with change since {data.previous_campaign?.name ?? 'the previous campaign'}, and each section’s score from red (low) to green (high).</p></div>
      <div className="reports-detail-filters reports-employee-filters"><input type="search" placeholder="Search employees" aria-label="Search employees" value={query} onChange={(event) => setQuery(event.target.value)} /><select value={role} onChange={(event) => setRole(event.target.value)} aria-label="Filter by company role"><option value="all">All roles</option>{roleOptions.map((item) => <option value={item} key={item}>{item}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value as EmployeeSort)} aria-label="Sort employees">{SORTS.filter((item) => item.value !== 'change' || data.previous_campaign).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}{data.sections.length > 0 && <optgroup label="Lowest first in section">{data.sections.map((section) => <option key={section.id} value={`section:${section.id}`}>{section.name}</option>)}</optgroup>}</select></div>
      {data.employees.length === 0 ? <ReportsEmptyState title="No employees in this campaign." message="Employee analytics will appear after people are assigned to campaign groups or evaluations." />
        : employees.length === 0 ? <ReportsEmptyState title="No employees match the filters." message="Adjust search, role or group filters to view employees." />
          : <div className="reports-table-scroll"><table><thead><tr><th>Employee</th><th>Group(s)</th><th className="reports-number-cell">Peer rating</th><th>Sections</th><th className="reports-number-cell">Peer reviews</th><th className="reports-number-cell">Self</th><th>Details</th></tr></thead><tbody>{employees.map((employee) => <EmployeeRow theme={theme} employee={employee} sections={data.sections} focusSection={sort.startsWith('section:') ? Number(sort.slice(8)) : null} campaignId={selectedCampaignId} previousName={data.previous_campaign?.name ?? null} key={employee.employee_id} />)}</tbody></table></div>}
    </section>
  </div>;
}

function EmployeeRow({ theme, employee, sections, focusSection, campaignId, previousName }: { focusSection: number | null; theme: ChartTheme; employee: EmployeeReportRow; sections: Array<{ id: number; name: string }>; campaignId: number; previousName: string | null }) {
  const { availability, reportable_sections, previous_overall_peer_score, overall_self_score, section_scores } = employee.performance_summary;
  const score = peerScore(employee);
  return <tr>
    <td><div className="reports-person-cell"><strong title={employee.employee_name}>{employee.employee_name}</strong><small title={`${employee.company_role}${employee.email ? ` · ${employee.email}` : ''}`}>{employee.company_role}</small></div></td>
    <td className="reports-groups-cell" title={employee.groups.join(', ')}>{employee.groups.length > 0 ? employee.groups.join(', ') : '—'}</td>
    <td className="reports-number-cell reports-peer-score" title={availability === 'suppressed' ? 'Individual score is withheld to protect confidentiality.' : `${reportable_sections} scored ${reportable_sections === 1 ? 'section' : 'sections'}`}>
      {score !== null ? <><strong>{score.toFixed(2)}</strong><Delta current={score} previous={previous_overall_peer_score} label={previousName ? `vs. ${previousName}` : undefined} /></> : <span className="reports-muted">{availability === 'suppressed' ? 'Hidden' : 'Not yet'}</span>}
    </td>
    <td><span className="reports-section-strip" role="img" aria-label={sections.map((section) => `${section.name}: ${section_scores[String(section.id)]?.toFixed(2) ?? 'not available'}`).join(', ')}>{sections.map((section) => {
      const value = section_scores[String(section.id)];
      return <span key={section.id} title={`${section.name}: ${value === undefined ? 'not rated' : value === null ? 'hidden or not enough ratings' : value.toFixed(2)}`} className={`${value === null || value === undefined ? 'is-empty' : ''}${section.id === focusSection ? ' is-focus' : ''}`.trim() || undefined} style={value !== null && value !== undefined ? { background: scoreColor(theme, value) } : undefined} />;
    })}</span></td>
    <td className="reports-number-cell" aria-label={`${employee.peer_completed} of ${employee.peer_assigned} incoming peer reviews completed`}>{employee.peer_completed} / {employee.peer_assigned}</td>
    <td className="reports-number-cell" title={score !== null && overall_self_score !== null ? `Self − peer: ${(overall_self_score - score).toFixed(2)}` : undefined}>{overall_self_score === null ? <span className="reports-muted">—</span> : overall_self_score.toFixed(2)}</td>
    <td><div className="reports-action-cell"><Link className="btn btn-secondary btn-small" to={`/reports/campaigns/${campaignId}/employees/${employee.employee_id}`}>View details</Link></div></td>
  </tr>;
}

export function EmployeeReportDetailPage() {
  const { campaignId, employeeId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const selectedEmployeeId = Number(employeeId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(selectedCampaignId) ? selectedCampaignId : null} allowWrittenFeedbackPreview>{({ getAccessToken, campaigns }) => {
    const campaign = campaigns.find((item) => item.id === selectedCampaignId);
    if (getAccessToken && Number.isSafeInteger(selectedEmployeeId) && selectedEmployeeId > 0 && (campaign?.campaign_status === 'active' || campaign?.campaign_status === 'paused')) {
      return <div className="reports-overview"><p className="reports-dashboard-note">Employee performance statistics become available in Review. Submitted feedback received by this employee can be read now.</p><WrittenFeedbackPreview key={`${selectedCampaignId}-${selectedEmployeeId}`} campaignId={selectedCampaignId} employeeId={selectedEmployeeId} getAccessToken={getAccessToken} /></div>;
    }
    return <EmployeeReportDetailContent campaignId={selectedCampaignId} employeeId={selectedEmployeeId} getAccessToken={getAccessToken} />;
  }}</ReportsLayout>;
}

function EmployeeReportDetailContent({ campaignId, employeeId, getAccessToken }: { campaignId: number; employeeId: number; getAccessToken: AccessTokenGetter | undefined }) {
  const navigate = useNavigate();
  const accessTokenRef = useRef(getAccessToken);
  accessTokenRef.current = getAccessToken;
  const [data, setData] = useState<EmployeeReportDetail | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  usePageTitle(data?.employee.id === employeeId ? data.employee.name : null, 'Employees', 'Reports');

  useEffect(() => {
    const tokenGetter = accessTokenRef.current;
    if (!tokenGetter) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchEmployeeReportDetail(tokenGetter, campaignId, employeeId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Employee report could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, !!getAccessToken, reload]);

  if (data === null || data.campaign.id !== campaignId || data.employee.id !== employeeId) return <LoadingOrError error={error} retry={() => setReload((value) => value + 1)} />;
  if (!getAccessToken) return <LoadingState variant="page" label="Checking your account" />;
  return <EmployeeReportDetailView data={data} getAccessToken={getAccessToken} onBack={() => navigate(`/reports/campaigns/${campaignId}/employees`)} />;
}
