import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Info } from 'lucide-react';
import { fetchCampaignRatingDistribution, fetchCampaignReportOverview, fetchEmployeeReportsOverview, fetchRolesReport } from './api/reports.api';
import { ComparisonChart, Histogram, HorizontalChart } from './components/OverviewCharts';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsKpiPanel from './components/ReportsKpiPanel';
import ReportsLayout from './ReportsLayout';
import type { CampaignRatingDistribution, CampaignReportOverview, EmployeeReportsOverview, ReportSectionScore, RolesReport } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';

function DashboardCard({ title, info, children, actions, className = '' }: { title: string; info: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={`reports-card reports-dashboard-card ${className}`}><div className="reports-dashboard-card-heading"><div className="reports-dashboard-card-title"><h2>{title}</h2><span className="reports-info-icon" title={info} aria-label={info} tabIndex={0}><Info size={15} /></span></div>{actions}</div>{children}</section>;
}

function SectionChart({ sections, base, palette }: { sections: ReportSectionScore[]; base: string; palette: string[] }) {
  const [sort, setSort] = useState<'highest' | 'lowest' | 'name'>('highest');
  const reportable = sections.filter((section) => section.availability === 'available' && section.average_score !== null);
  const sorted = [...reportable].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'lowest' ? a.average_score! - b.average_score! || a.name.localeCompare(b.name) : b.average_score! - a.average_score! || a.name.localeCompare(b.name));
  const visible = sections.length > 8 ? sorted.slice(0, 6) : sorted;
  return <DashboardCard title="Average Rating by Section" info="Normalized peer section scores; evaluated employees contribute equally. Suppressed scores are excluded." actions={<div className="reports-chart-toolbar"><select aria-label="Sort sections" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="highest">Highest first</option><option value="lowest">Lowest first</option><option value="name">Name A–Z</option></select>{sections.length > 8 && <Link to={`${base}/detailed`}>View all</Link>}</div>}>
    <HorizontalChart relaxed={visible.length <= 3} axisLabel="Average peer rating (1–5)" series={visible.map((section) => ({ id: String(section.id), label: section.name, color: palette[sections.findIndex((item) => item.id === section.id) % palette.length], value: section.average_score, href: `${base}/detailed?section=${section.id}` }))} />
    {sections.length > reportable.length && <p className="reports-chart-notice">{sections.length - reportable.length} section {sections.length - reportable.length === 1 ? 'rating is' : 'ratings are'} unavailable or withheld.</p>}
  </DashboardCard>;
}

function RatingDistributionChart({ data, sections }: { data: CampaignRatingDistribution; sections: ReportSectionScore[] }) {
  const [mode, setMode] = useState<'campaign' | 'section'>('campaign');
  const [sectionId, setSectionId] = useState<number | null>(null);
  const selectedId = sectionId !== null && data.sections.some((item) => item.section_id === sectionId) ? sectionId : data.sections[0]?.section_id;
  const result = mode === 'campaign' ? data.campaign : data.sections.find((item) => item.section_id === selectedId);
  return <DashboardCard title="Rating Distribution" info={`Each peer rating is converted from its original scale to 1–5. Labels 1–2, 2–3 and 3–4 include the lower value but not the upper; 4–5 includes 5. This counts only privacy-released responses, not employee averages. ${data.notes}`}><div className="reports-distribution-controls"><div className="reports-segmented" role="group" aria-label="Rating distribution scope"><button type="button" aria-pressed={mode === 'campaign'} className={mode === 'campaign' ? 'active' : ''} onClick={() => setMode('campaign')}>Campaign</button><button type="button" aria-pressed={mode === 'section'} disabled={!data.sections.length} className={mode === 'section' ? 'active' : ''} onClick={() => setMode('section')}>By Section</button></div>{mode === 'section' && data.sections.length > 1 && <select className="form-control" aria-label="Select distribution section" value={selectedId ?? ''} onChange={(event) => setSectionId(Number(event.target.value))}>{data.sections.map((item) => <option value={item.section_id ?? ''} key={item.section_id}>{sections.find((section) => section.id === item.section_id)?.name ?? `Section ${item.section_id}`}</option>)}</select>}</div>
    {result?.availability === 'available' && result.bins ? <><p className="reports-chart-question">Based on {result.response_count} peer ratings</p><Histogram buckets={result.bins} /></> : <p className="reports-chart-notice">{result?.availability === 'suppressed' ? 'No privacy-released rating responses for this scope.' : 'No rating responses for this scope.'}</p>}
  </DashboardCard>;
}

export function ReportsIndexPage() {
  return <ReportsLayout selectedCampaignId={null}>{({ loadingCampaigns, campaignsError, campaigns, retryCampaigns }) => {
    if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
    if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
    if (campaigns.length === 0) return <ReportsEmptyState title="No campaigns available." message="Create a campaign before reports can be shown." />;
    return <div className="reports-state">Opening selected campaign...</div>;
  }}</ReportsLayout>;
}

export default function CampaignOverviewPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;

  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{(layoutState) => <OverviewContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layoutState} />}</ReportsLayout>;
}

function OverviewContent({
  selectedCampaignId,
  validCampaignId,
  getAccessToken,
  loadingCampaigns,
  campaignsError,
  campaigns,
  retryCampaigns,
}: {
  selectedCampaignId: number;
  validCampaignId: boolean;
  campaigns: Array<{ id: number }>;
  getAccessToken: AccessTokenGetter | undefined;
  loadingCampaigns: boolean;
  campaignsError: string;
  retryCampaigns: () => void;
}) {
  const [data, setData] = useState<CampaignReportOverview | null>(null);
  const [roles, setRoles] = useState<RolesReport | null>(null);
  const [employees, setEmployees] = useState<EmployeeReportsOverview | null>(null);
  const [distribution, setDistribution] = useState<CampaignRatingDistribution | null>(null);
  const [distributionError, setDistributionError] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  useEffect(() => {
    const token = tokenRef.current;
    if (!validCampaignId || !token) return undefined;
    const controller = new AbortController();
    setData(null);
    setRoles(null);
    setEmployees(null);
    setDistribution(null);
    setDistributionError(false);
    setError('');
    fetchCampaignReportOverview(token, selectedCampaignId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Campaign report could not be loaded.');
      });
    fetchRolesReport(token, selectedCampaignId, 'evaluatee', controller.signal).then((result) => { if (!controller.signal.aborted) setRoles(result); }).catch(() => { if (!controller.signal.aborted) setRoles(null); });
    fetchEmployeeReportsOverview(token, selectedCampaignId, controller.signal).then((result) => { if (!controller.signal.aborted) setEmployees(result); }).catch(() => { if (!controller.signal.aborted) setEmployees(null); });
    fetchCampaignRatingDistribution(token, selectedCampaignId, controller.signal).then((result) => { if (!controller.signal.aborted) setDistribution(result); }).catch(() => { if (!controller.signal.aborted) setDistributionError(true); });
    return () => controller.abort();
  }, [!!getAccessToken, reloadKey, selectedCampaignId, validCampaignId]);

  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
  if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  if (error) return <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>;
  if (data === null || data.campaign.id !== selectedCampaignId) return <div className="reports-state">Loading campaign analytics...</div>;

  const noAssignments = data.kpis.total_evaluations === 0;
  const noCompleted = data.kpis.total_evaluations > 0 && data.kpis.completed_evaluations === 0;

  const base = `/reports/campaigns/${selectedCampaignId}`;
  const palette = ['#3468cc', '#8061cb', '#1a9d7b', '#4384b8', '#549d89', '#926fb1'];
  const ratingAvailable = distribution?.campaign.availability === 'available' && distribution.campaign.bins !== null;
  const sections = data.sections.filter((section) => section.availability === 'available' && section.average_score !== null);
  const groups = data.groups.filter((group) => group.completion_rate !== null);
  const people = (employees?.campaign.id === selectedCampaignId ? employees.employees : []).filter((employee) => data.sections.length > 0 && employee.performance_summary.availability === 'available' && employee.performance_summary.overall_peer_score !== null && employee.performance_summary.reportable_sections === data.sections.length);
  const reportableRoles = (roles?.campaign.id === selectedCampaignId ? roles.roles : []).filter((role) => role.score_availability === 'available' && role.average_score !== null);
  return <div className="reports-overview reports-overview-dashboard"><ReportsKpiPanel kpis={data.kpis} />{noAssignments && <p className="reports-dashboard-note">No evaluations have been assigned yet.</p>}{noCompleted && <p className="reports-dashboard-note">No evaluations have been completed yet. Charts use submitted responses only.</p>}<div className="reports-chart-grid reports-dashboard-grid">
    {sections.length > 0 && <SectionChart key={`${selectedCampaignId}-sections`} sections={data.sections} base={base} palette={palette} />}
    {distribution && ratingAvailable && <RatingDistributionChart key={`${selectedCampaignId}-distribution`} data={distribution} sections={data.sections} />}
    {groups.length > 0 && <DashboardCard key={`${selectedCampaignId}-groups`} title="Completion Rate by Group" info="Completed / assigned evaluations attributed to each assignment group. Click a bar for group details." className="reports-group-chart" actions={groups.length > 5 ? <Link className="reports-card-action" to={`${base}/groups`}>All groups</Link> : undefined}><HorizontalChart legend relaxed={groups.length <= 2} maximum={100} unit="%" series={groups.map((group, index) => ({ id: String(group.group_id), label: group.group_name, color: palette[index % palette.length], value: group.completion_rate, detail: `${group.completed_evaluations} / ${group.total_evaluations}`, href: `${base}/groups/${group.group_id}` }))} /></DashboardCard>}
    {people.length > 0 && <DashboardCard key={`${selectedCampaignId}-people`} title="Employee Comparison" info="Only employees with reportable peer scores in every issued campaign section are compared, so each overall score uses the same section basis."><ComparisonChart employeesPath={`${base}/employees`} series={people.map((employee, index) => ({ id: String(employee.employee_id), label: employee.employee_name, color: palette[index % palette.length], value: employee.performance_summary.overall_peer_score, href: `${base}/employees/${employee.employee_id}` }))} /></DashboardCard>}
    {reportableRoles.length > 0 && <DashboardCard key={`${selectedCampaignId}-roles`} title="Rating by Role" info="Privacy-cleared peer ratings received by evaluated role." className="reports-role-chart"><HorizontalChart legend series={reportableRoles.map((role, index) => ({ id: String(role.role_id), label: role.role_name, color: palette[index % palette.length], value: role.average_score, href: `${base}/roles/${role.role_id}` }))} /></DashboardCard>}
  </div>{distributionError && <p className="reports-dashboard-note">Rating distribution could not be loaded.</p>}{distribution && !ratingAvailable && <p className="reports-dashboard-note">No privacy-released campaign rating distribution is available.</p>}{!sections.length && !ratingAvailable && !groups.length && !people.length && !distributionError && <p className="reports-dashboard-note">No privacy-cleared chart data is available for this campaign yet.</p>}{!people.length && (employees?.employees.length ?? 0) > 0 && <p className="reports-dashboard-note">Employee comparison is unavailable unless employees have reportable peer ratings for the same issued sections. <Link to={`${base}/employees`}>View all employees</Link></p>}</div>;
}
