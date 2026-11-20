import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { csvScore } from './reportExport';
import { fetchCampaignDashboard, fetchCampaignRatingDistribution } from './api/reports.api';
import ReportsEmptyState from './components/ReportsEmptyState';
import EvaluationQualitySummary from './components/EvaluationQualitySummary';
import { DimensionSwitch, GroupToggles, MAX_COMPARED_GROUPS, SectionTabs } from './components/ReportFilterBar';
import GroupPanel from './components/GroupPanel';
import { GROUP_NOUN, reportScopeTitle, ROLE_NOUN, type Noun } from './reports.utils';
import { ChartCard, CompletionDonut, CsvButton, Delta, DistributionBars, GapBars, GroupedBars, Heatmap, MeterRows, ScoreBars, TrendLines, type HeatmapRow, type TrendSeries } from './charts/DashboardCharts';
import SectionQuestionList from './charts/SectionQuestionList';
import { scoreColor, SERIES_COUNT, seriesColor, useChartTheme, type ChartTheme } from './charts/chartTheme';
import ReportsLayout from './ReportsLayout';
import type { CampaignDashboard, CampaignRatingDistribution, DashboardGroup, DashboardTrendPoint, ReportCampaignOption } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { useAppAuth } from '../../auth/AppAuth';
import { hasTeamReportsOnly } from '../../app/access';
import LoadError from '../../components/feedback/LoadError';
import LoadingState from '../../components/feedback/LoadingState';

export function ReportsIndexPage() {
  const { state } = useAppAuth();
  const teamOnly = state.status === 'authenticated' && hasTeamReportsOnly(state.user.permissions);
  return <ReportsLayout selectedCampaignId={null}>{({ loadingCampaigns, campaignsError, campaigns, retryCampaigns }) => {
    if (loadingCampaigns) return <LoadingState variant="page" label="Loading campaigns" />;
    if (campaignsError) return <LoadError message={campaignsError} onRetry={retryCampaigns} />;
    if (campaigns.length === 0) return <ReportsEmptyState title="No campaigns available." message={teamOnly ? 'There are no campaigns yet for the groups you lead.' : 'Create a campaign before reports can be shown.'} />;
    return <LoadingState variant="page" label="Opening campaign" />;
  }}</ReportsLayout>;
}

export default function CampaignOverviewPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;

  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null} allowQualityPreview>{(layoutState) => <OverviewContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layoutState} />}</ReportsLayout>;
}

function OverviewContent({ selectedCampaignId, validCampaignId, getAccessToken, loadingCampaigns, campaignsError, campaigns, retryCampaigns }: {
  selectedCampaignId: number;
  validCampaignId: boolean;
  campaigns: ReportCampaignOption[];
  getAccessToken: AccessTokenGetter | undefined;
  loadingCampaigns: boolean;
  campaignsError: string;
  retryCampaigns: () => void;
}) {
  const [data, setData] = useState<CampaignDashboard | null>(null);
  const [distribution, setDistribution] = useState<CampaignRatingDistribution | null>(null);
  const [distributionFailed, setDistributionFailed] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const { state } = useAppAuth();
  const qualityAuthorized = state.status === 'authenticated' && state.user.permissions.includes('reports.read') && state.user.permissions.includes('campaigns.manage');
  const actorId = state.status === 'authenticated' ? state.user.id : null;
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const qualityPreview = !!(qualityAuthorized && selectedCampaign && !selectedCampaign.is_archived && (selectedCampaign.campaign_status === 'active' || selectedCampaign.campaign_status === 'paused'));
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;

  useEffect(() => {
    const token = tokenRef.current;
    if (!validCampaignId || !token || qualityPreview) return undefined;
    const controller = new AbortController();
    setData(null);
    setDistribution(null);
    setDistributionFailed(false);
    setError('');
    fetchCampaignDashboard(token, selectedCampaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Campaign report could not be loaded.'); });
    fetchCampaignRatingDistribution(token, selectedCampaignId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDistribution(result); })
      .catch(() => { if (!controller.signal.aborted) setDistributionFailed(true); });
    return () => controller.abort();
  }, [!!getAccessToken, reloadKey, selectedCampaignId, validCampaignId, qualityPreview]);

  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <LoadingState variant="page" label="Loading campaigns" />;
  if (campaignsError) return <LoadError message={campaignsError} onRetry={retryCampaigns} />;
  if (!selectedCampaign) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  if (qualityPreview) return <div className="reports-overview reports-overview-dashboard"><p className="reports-dashboard-note">Campaign performance charts become available in Review. Completed peer evaluations can already be checked for campaign-level quality patterns.</p><EvaluationQualitySummary campaignId={selectedCampaignId} actorId={actorId} getAccessToken={getAccessToken} authorized={qualityAuthorized} /></div>;
  if (error) return <LoadError message={error} onRetry={() => setReloadKey((value) => value + 1)} />;
  if (data === null || data.campaign.id !== selectedCampaignId) return <LoadingState variant="page" label="Loading campaign report" />;

  return <div className="reports-overview reports-overview-dashboard">
    <Dashboard getAccessToken={getAccessToken} data={data} distribution={distribution?.campaign ? distribution : null} distributionFailed={distributionFailed} onRetry={() => setReloadKey((value) => value + 1)} />
    <EvaluationQualitySummary campaignId={selectedCampaignId} actorId={actorId} getAccessToken={getAccessToken} authorized={qualityAuthorized} />
  </div>;
}

function sectionRows(data: CampaignDashboard) {
  return [
    ['Section', 'Peer rating', data.previous_campaign ? `Previous (${data.previous_campaign.name})` : 'Previous', 'Change'],
    ...data.sections.map((section) => [section.name, csvScore(section.score, section.availability), csvScore(section.previous_score),
      section.availability === 'available' && section.score !== null && section.previous_score !== null ? (section.score - section.previous_score).toFixed(2) : '']),
    ['All sections', csvScore(data.overall.score, data.overall.availability), csvScore(data.overall.previous_score), ''],
  ];
}

function matrixRows(data: CampaignDashboard, groups: DashboardGroup[], dim: Dim) {
  return [
    [dim.One, 'Overall', 'Completion %', ...data.sections.map((section) => section.name)],
    ...groups.map((group) => [group.name, csvScore(group.overall.score, group.overall.availability), group.completion_rate,
      ...data.sections.map((section) => csvScore(group.sections[String(section.id)]?.score, group.sections[String(section.id)]?.availability))]),
    [dim.all, csvScore(data.overall.score, data.overall.availability), data.completion.rate, ...data.sections.map((section) => csvScore(section.score, section.availability))],
  ];
}

/** The cohort the Overview compares: assignment groups, or the evaluated employees' company roles at issuance. */
type Dim = Noun & { key: 'groups' | 'roles' };
const DIMS: Record<Dim['key'], Dim> = { groups: { ...GROUP_NOUN, key: 'groups' }, roles: { ...ROLE_NOUN, key: 'roles' } };
const trendOverall = (point: DashboardTrendPoint, dim: Dim) => (dim.key === 'roles' ? point.roles : point.groups) ?? {};
const trendSections = (point: DashboardTrendPoint, dim: Dim) => (dim.key === 'roles' ? point.role_sections : point.group_sections) ?? {};

function useReportScope(data: CampaignDashboard) {
  const [params, setParams] = useSearchParams();
  const sectionParam = Number(params.get('section'));
  const section = data.sections.find((item) => item.id === sectionParam);
  const dim = DIMS[params.get('by') === 'roles' && (data.roles ?? []).length > 0 ? 'roles' : 'groups'];
  const cohorts = (dim.key === 'roles' ? data.roles : data.groups) ?? [];
  const groupIds = (params.get(dim.key) ?? '').split(',').map(Number).filter((id) => cohorts.some((group) => group.id === id)).slice(0, MAX_COMPARED_GROUPS);
  const update = (changes: { section?: number | null; groups?: number[]; by?: Dim['key'] }) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (changes.section !== undefined) { if (changes.section === null) next.delete('section'); else next.set('section', String(changes.section)); }
    if (changes.by !== undefined) {
      next.delete('groups');
      next.delete('roles');
      if (changes.by === 'roles') next.set('by', 'roles'); else next.delete('by');
    }
    const key = changes.by ?? dim.key;
    if (changes.groups !== undefined) { if (changes.groups.length === 0) next.delete(key); else next.set(key, changes.groups.join(',')); }
    return next;
  }, { replace: true });
  return { section, groupIds, update, dim, cohorts };
}

const shortCampaign = (campaign: ReportCampaignOption) => campaign.name.length > 14 ? `${campaign.name.slice(0, 13)}…` : campaign.name;

function Dashboard({ getAccessToken, data, distribution, distributionFailed, onRetry }: { getAccessToken: AccessTokenGetter | undefined; data: CampaignDashboard; distribution: CampaignRatingDistribution | null; distributionFailed: boolean; onRetry: () => void }) {
  const theme = useChartTheme();
  const { section, groupIds, update, dim, cohorts } = useReportScope(data);
  // Groups and roles keep the colour of their place in the campaign; past eight they take a free slot in the comparison.
  const colorOf = useMemo(() => {
    const index = new Map(cohorts.map((group, position) => [group.id, position]));
    return (id: number) => cohorts.length <= SERIES_COUNT ? seriesColor(theme, index.get(id) ?? 0) : seriesColor(theme, Math.max(groupIds.indexOf(id), 0));
  }, [cohorts, groupIds, theme]);
  const selectedGroups = groupIds.map((id) => cohorts.find((group) => group.id === id)!);
  // A heatmap cell opens that section; a group's cell also brings the group into the comparison.
  const focusCell = (sectionId: number, groupId: number | null) => update({ section: sectionId, ...(groupId !== null && !groupIds.includes(groupId) && groupIds.length < MAX_COMPARED_GROUPS ? { groups: [...groupIds, groupId] } : {}) });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // A trend point opens that campaign with the same section and groups; ones it lacks are dropped there.
  const openCampaign = (point: Record<string, string | number | null>) => {
    if (typeof point.campaignId === 'number' && point.campaignId !== data.campaign.id) navigate(`/reports/campaigns/${point.campaignId}${params.size ? `?${params}` : ''}`);
  };
  // The Employees report filters by group only, so in role mode its links open the unfiltered list.
  const employeesLink = (ids: number[], sectionId?: number) => {
    if (dim.key === 'roles') ids = [];
    const query = new URLSearchParams();
    if (ids.length) query.set('groups', ids.join(','));
    if (sectionId) query.set('section', String(sectionId));
    return `/reports/campaigns/${data.campaign.id}/employees${query.size ? `?${query}` : ''}`;
  };
  const compareGroup = (groupId: number) => { if (!groupIds.includes(groupId) && groupIds.length < MAX_COMPARED_GROUPS) update({ groups: [...groupIds, groupId] }); };

  return <>
    <div className="reports-scope-bar">
      <SectionTabs sections={data.sections} selected={section?.id ?? null} onSelect={(id) => update({ section: id })} />
      <div className="reports-scope-row">
        {(data.roles ?? []).length > 0 && <DimensionSwitch value={dim.key} onChange={(by) => update({ by })} />}
        <GroupToggles groups={cohorts} selected={groupIds} colorOf={colorOf} noun={dim} onChange={(groups) => update({ groups })} />
        <p className="reports-scope-title" aria-live="polite">{reportScopeTitle(section, selectedGroups, dim.all)}</p>
      </div>
    </div>
    {data.completion.completed_evaluations === 0 && <p className="reports-dashboard-note">{data.completion.total_evaluations === 0 ? 'No evaluations have been assigned yet.' : 'No evaluations have been completed yet. Charts use submitted responses only.'}</p>}
    {section
      ? <SectionView theme={theme} data={data} dim={dim} cohorts={cohorts} onTrend={openCampaign} employeesLink={employeesLink} sectionId={section.id} groups={selectedGroups} colorOf={colorOf} distribution={distribution} onCompare={compareGroup} questions={<SectionQuestionList theme={theme} campaignId={data.campaign.id} sectionId={section.id} groupIds={groupIds} dimension={dim.key} colorOf={colorOf} getAccessToken={getAccessToken} />} />
      : selectedGroups.length
        ? <GroupsView theme={theme} data={data} dim={dim} onTrend={openCampaign} employeesLink={employeesLink} groups={selectedGroups} colorOf={colorOf} onCell={focusCell}
          panel={dim.key === 'groups' && selectedGroups.length === 1 ? <GroupPanel key={selectedGroups[0].id} campaignId={data.campaign.id} group={selectedGroups[0]} campaignScore={available(data.overall)} getAccessToken={getAccessToken} /> : null} />
        : <CampaignView theme={theme} data={data} dim={dim} cohorts={cohorts} onTrend={openCampaign} colorOf={colorOf} distribution={distribution} onSection={(id) => update({ section: id })} onCell={focusCell} />}
    {distributionFailed && <LoadError message="The rating distribution couldn’t load." onRetry={onRetry} />}
    {data.previous_campaign && <p className="reports-chart-footnote">Changes compare with {data.previous_campaign.name}, the previous reportable campaign.</p>}
  </>;
}

const available = (score: { score: number | null; availability: string } | undefined) => score?.availability === 'available' ? score.score : null;

function Kpi({ label, value, valueStyle, children }: { label: string; value: string; valueStyle?: React.CSSProperties; children?: React.ReactNode }) {
  return <div className="reports-kpi-card"><span>{label}</span><strong style={valueStyle} title={value}>{value}</strong><small>{children}</small></div>;
}

function CampaignView({ theme, data, dim, cohorts, colorOf, distribution, onSection, onCell, onTrend }: { onTrend: (point: Record<string, string | number | null>) => void; theme: ChartTheme; data: CampaignDashboard; dim: Dim; cohorts: DashboardGroup[]; colorOf: (id: number) => string; distribution: CampaignRatingDistribution | null; onSection: (id: number) => void; onCell: (sectionId: number, groupId: number | null) => void }) {
  const reportable = data.sections.filter((item) => item.availability === 'available' && item.score !== null).sort((a, b) => b.score! - a.score!);
  const hiddenSections = data.sections.length - reportable.length;
  const overall = available(data.overall);
  const strongest = reportable[0];
  const weakest = reportable.length > 1 ? reportable[reportable.length - 1] : undefined;
  const vsPrevious = data.previous_campaign ? `vs. ${data.previous_campaign.name}` : '';
  const change = (current: number | null, previous: number | null, fallback: string, digits = 2, unit = '') => current !== null && previous !== null
    ? <><Delta current={current} previous={previous} digits={digits} unit={unit} label={vsPrevious} /> {vsPrevious}</> : fallback;
  const trend = data.trend.filter((point) => point.overall !== null).length > 1;
  const groupRows: HeatmapRow[] = cohorts.map((group) => ({ id: group.id, name: group.name, color: colorOf(group.id), cells: group.sections }));
  const campaignRow: HeatmapRow = { id: 0, name: dim.all, emphasis: true, cells: Object.fromEntries(data.sections.map((item) => [String(item.id), item])) };
  const ratingBins = distribution?.campaign.availability === 'available' ? distribution.campaign.bins : null;

  return <>
    <section className="reports-kpi-row" aria-label="Campaign metrics">
      <Kpi label="Average peer rating" value={overall === null ? (data.overall.availability === 'suppressed' ? 'Hidden' : '–') : overall.toFixed(2)}>{change(overall, data.overall.previous_score, 'Peer ratings on a 1–5 scale')}</Kpi>
      <Kpi label="Completion" value={data.completion.rate === null ? '–' : `${data.completion.rate}%`}>{change(data.completion.rate, data.completion.previous_rate, `${data.completion.completed_evaluations} / ${data.completion.total_evaluations} evaluations`, 0, ' pt')}</Kpi>
      <Kpi label="Strongest section" value={strongest?.name ?? '–'} valueStyle={strongest ? { color: scoreColor(theme, strongest.score!) } : undefined}>{strongest ? <>{strongest.score!.toFixed(2)} {change(strongest.score, strongest.previous_score, '')}</> : 'Not enough released ratings'}</Kpi>
      <Kpi label="Development area" value={weakest?.name ?? '–'} valueStyle={weakest ? { color: scoreColor(theme, weakest.score!) } : undefined}>{weakest ? <>{weakest.score!.toFixed(2)} {change(weakest.score, weakest.previous_score, '')}</> : 'Needs at least two released sections'}</Kpi>
    </section>

    <div className="reports-viz-grid">
      {reportable.length > 0 && <ChartCard actions={<CsvButton name={`${data.campaign.name} sections`} rows={() => sectionRows(data)} />} title="Average rating by section" subtitle={`Peer ratings, 1–5 · colour follows the score · line = campaign average${hiddenSections ? ` · ${hiddenSections} hidden or without ratings` : ''}`}>
        <ScoreBars theme={theme} rows={reportable.map((item) => ({ id: item.id, name: item.name, score: item.score, previous: item.previous_score }))} reference={overall} referenceLabel="Campaign average" onSelect={onSection} />
      </ChartCard>}
      {reportable.length > 0 && <ChartCard title="Strengths and development areas" subtitle={data.previous_campaign ? `Change since ${data.previous_campaign.name}` : 'Sections from highest to lowest'}>
        <ol className="reports-rank-list">{reportable.map((item, index) => <li key={item.id}>
          <button type="button" onClick={() => onSection(item.id)}><i style={{ background: scoreColor(theme, item.score!) }} aria-hidden="true" /><span className="reports-rank-name">{item.name}</span>
            {reportable.length > 3 && index < 2 && <em className="is-strength">Strength</em>}{reportable.length > 3 && index >= reportable.length - 2 && <em className="is-develop">Develop</em>}</button>
          <strong>{item.score!.toFixed(2)}</strong><Delta current={item.score} previous={item.previous_score} label={data.previous_campaign ? `vs. ${data.previous_campaign.name}` : undefined} />
        </li>)}</ol>
      </ChartCard>}
    </div>

    {cohorts.length > 0 && data.sections.length > 0 && <ChartCard actions={<CsvButton name={`${data.campaign.name} ${dim.many} by section`} rows={() => matrixRows(data, cohorts, dim)} />} title={`${dim.Many} × sections`} subtitle={`Each cell is the ${dim.one}’s peer rating${dim.key === 'roles' ? ' (role of the evaluated employee)' : ''} · hatched = hidden by the privacy threshold · click a cell for its questions`}>
      <Heatmap theme={theme} sections={data.sections} rows={[...groupRows, campaignRow]} onCell={onCell} />
    </ChartCard>}

    <div className="reports-viz-grid">
      {data.completion.total_evaluations > 0 && <ChartCard title="Completion" subtitle={dim.key === 'roles' ? 'Submitted evaluations per evaluated employee’s role' : 'Submitted evaluations per assignment group'}>
        <div className="reports-completion"><CompletionDonut theme={theme} completed={data.completion.completed_evaluations} total={data.completion.total_evaluations} />
          <MeterRows rows={cohorts.filter((group) => group.total_evaluations > 0).map((group) => ({ id: group.id, name: group.name, value: group.completion_rate, color: colorOf(group.id), detail: `${group.completed_evaluations} / ${group.total_evaluations} completed` }))} />
        </div>
      </ChartCard>}
      {ratingBins && <ChartCard title="How ratings are spread" subtitle={`${distribution!.campaign.response_count} peer ratings, converted to 1–5`}>
        <DistributionBars theme={theme} bins={ratingBins} />
      </ChartCard>}
    </div>

    {dim.key === 'roles' && <RaterCalibration theme={theme} data={data} />}
    {trend && <ChartCard title="Over time" subtitle="Peer rating in recent reportable campaigns · click a point to open that campaign">
      <TrendLines theme={theme} points={data.trend.map((point) => ({ campaignId: point.campaign.id, label: shortCampaign(point.campaign), fullName: point.campaign.name, overall: point.overall }))} series={[{ key: 'overall', name: 'Average peer rating', color: theme.primary }]} onSelect={onTrend} />
    </ChartCard>}
    {reportable.length === 0 && !ratingBins && <p className="reports-dashboard-note">No privacy-cleared chart data is available for this campaign yet.</p>}
  </>;
}

function GroupsView({ theme, data, dim, groups, colorOf, onCell, onTrend, employeesLink, panel }: { onTrend: (point: Record<string, string | number | null>) => void; employeesLink: (groupIds: number[], sectionId?: number) => string; theme: ChartTheme; data: CampaignDashboard; dim: Dim; groups: DashboardGroup[]; colorOf: (id: number) => string; onCell: (sectionId: number, groupId: number | null) => void; panel: React.ReactNode }) {
  const overall = available(data.overall);
  const series = groups.map((group) => ({ id: group.id, name: group.name, color: colorOf(group.id), values: Object.fromEntries(Object.entries(group.sections).map(([id, cell]) => [id, available(cell)])) }));
  const trendSeries: TrendSeries[] = [...groups.map((group) => ({ key: `g${group.id}`, name: group.name, color: colorOf(group.id) })), { key: 'overall', name: dim.all, color: theme.textMuted, dashed: true }];
  const hasScores = groups.some((group) => Object.values(group.sections).some((cell) => available(cell) !== null));
  return <>
    {panel}
    {!panel && <section className="reports-kpi-row" aria-label={`${dim.One} metrics`}>{groups.map((group) => {
      const score = available(group.overall);
      return <div key={group.id} className="reports-kpi-card reports-kpi-group" style={{ borderTopColor: colorOf(group.id) }}>
        <span>{group.name}</span>
        <strong style={score !== null ? { color: scoreColor(theme, score) } : undefined}>{score === null ? (group.overall.availability === 'suppressed' ? 'Hidden' : '–') : score.toFixed(2)}</strong>
        <small><Delta current={score} previous={overall} label={`vs. ${dim.all.toLowerCase()}`} /> vs. {dim.all.toLowerCase()} {data.previous_campaign && <><Delta current={score} previous={group.overall.previous_score} label={`vs. ${data.previous_campaign.name}`} /> vs. previous</>}</small>
        <small>{group.completion_rate === null ? 'No assignments' : `${group.completion_rate}% complete · ${group.employee_count} ${dim.key === 'roles' ? 'evaluated' : 'members'}`}{dim.key === 'groups' && <> · <Link className="reports-no-print" to={employeesLink([group.id])}>Employees →</Link></>}</small>
      </div>;
    })}</section>}
    {hasScores ? <ChartCard title={`Sections by ${dim.one}`} subtitle={`Peer ratings, 1–5 · line = campaign average${overall !== null ? ` (${overall.toFixed(2)})` : ''}`}>
      <GroupedBars theme={theme} categories={data.sections} series={series} reference={overall} />
    </ChartCard> : <p className="reports-dashboard-note">The selected {dim.many} have no released section ratings. Small {dim.many} are hidden by the privacy threshold.</p>}
    <ChartCard actions={<CsvButton name={`${data.campaign.name} ${dim.many} by section`} rows={() => matrixRows(data, groups, dim)} />} title={`${dim.Many} × sections`} subtitle={`Selected ${dim.many} and the campaign · hatched = hidden by the privacy threshold`}>
      <Heatmap theme={theme} sections={data.sections} rows={[...groups.map((group) => ({ id: group.id, name: group.name, color: colorOf(group.id), cells: group.sections })), { id: 0, name: dim.all, emphasis: true, cells: Object.fromEntries(data.sections.map((item) => [String(item.id), item])) }]} onCell={onCell} />
    </ChartCard>
    {data.trend.length > 1 && <ChartCard title="Over time" subtitle={`${dim.One} peer rating in recent reportable campaigns · click a point to open that campaign`}>
      <TrendLines theme={theme} points={data.trend.map((point) => ({ campaignId: point.campaign.id, label: shortCampaign(point.campaign), fullName: point.campaign.name, overall: point.overall, ...Object.fromEntries(groups.map((group) => [`g${group.id}`, trendOverall(point, dim)[String(group.id)] ?? null])) }))} series={trendSeries} onSelect={onTrend} />
    </ChartCard>}
  </>;
}

function SectionView({ theme, data, dim, cohorts, sectionId, groups, colorOf, distribution, onCompare, questions, onTrend, employeesLink }: { onTrend: (point: Record<string, string | number | null>) => void; employeesLink: (groupIds: number[], sectionId?: number) => string; theme: ChartTheme; data: CampaignDashboard; dim: Dim; cohorts: DashboardGroup[]; sectionId: number; groups: DashboardGroup[]; colorOf: (id: number) => string; distribution: CampaignRatingDistribution | null; onCompare: (groupId: number) => void; questions: React.ReactNode }) {
  const section = data.sections.find((item) => item.id === sectionId)!;
  const score = available(section);
  const selected = new Set(groups.map((group) => group.id));
  const ranked = cohorts.map((group) => ({ id: group.id, name: group.name, score: available(group.sections[String(sectionId)]), muted: selected.size > 0 && !selected.has(group.id) })).filter((row) => row.score !== null).sort((a, b) => b.score! - a.score!);
  const hiddenGroups = cohorts.filter((group) => group.sections[String(sectionId)]?.availability === 'suppressed').length;
  const sectionBins = distribution?.sections.find((item) => item.section_id === sectionId);
  const trendPoints = data.trend.map((point) => ({ campaignId: point.campaign.id, label: shortCampaign(point.campaign), fullName: point.campaign.name, section: point.sections[String(sectionId)] ?? null, overall: point.overall,
    ...Object.fromEntries(groups.map((group) => [`g${group.id}`, trendSections(point, dim)[String(group.id)]?.[String(sectionId)] ?? null])) }));
  const trendSeries: TrendSeries[] = groups.length
    ? [...groups.map((group) => ({ key: `g${group.id}`, name: group.name, color: colorOf(group.id) })), { key: 'section', name: dim.all, color: theme.textMuted, dashed: true }]
    : [{ key: 'section', name: section.name, color: theme.primary }, { key: 'overall', name: 'All sections', color: theme.textMuted, dashed: true }];
  return <>
    <section className="reports-kpi-row" aria-label={`${section.name} metrics`}>
      <Kpi label={`${section.name} · ${dim.all.toLowerCase()}`} value={score === null ? (section.availability === 'suppressed' ? 'Hidden' : '–') : score.toFixed(2)} valueStyle={score !== null ? { color: scoreColor(theme, score) } : undefined}>
        <Delta current={score} previous={available(data.overall)} label="vs. average of all sections" /> vs. all sections {data.previous_campaign && <><Delta current={score} previous={section.previous_score} label={`vs. ${data.previous_campaign.name}`} /> vs. previous</>}
      </Kpi>
      {groups.map((group) => {
        const value = available(group.sections[String(sectionId)]);
        return <div key={group.id} className="reports-kpi-card reports-kpi-group" style={{ borderTopColor: colorOf(group.id) }}><span>{group.name} · {section.name}</span><strong style={value !== null ? { color: scoreColor(theme, value) } : undefined}>{value === null ? (group.sections[String(sectionId)]?.availability === 'suppressed' ? 'Hidden' : '–') : value.toFixed(2)}</strong><small><Delta current={value} previous={score} label={`vs. ${dim.all.toLowerCase()}`} /> vs. {dim.all.toLowerCase()}</small></div>;
      })}
    </section>
    <div className="reports-viz-grid">
      <ChartCard title={`${dim.all} on ${section.name}`} subtitle={`${selected.size ? `Selected ${dim.many} highlighted · ` : ''}colour follows the score · line = ${dim.all.toLowerCase()}${hiddenGroups ? ` · ${hiddenGroups} hidden by the privacy threshold` : ''}`}
        actions={<span className="reports-card-actions reports-no-print">{dim.key === 'groups' && <Link className="reports-card-action" to={employeesLink(groups.map((group) => group.id), sectionId)}>Employees →</Link>}<button type="button" className="reports-card-action" onClick={() => document.getElementById('section-questions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Questions ↓</button></span>}>
        {ranked.length ? <ScoreBars theme={theme} rows={ranked} reference={score} referenceLabel={dim.all} onSelect={onCompare} /> : <p className="reports-chart-notice">No {dim.one} has a released rating for this section.</p>}
      </ChartCard>
      <ChartCard title={`How ${section.name} answers are spread`} subtitle={sectionBins?.availability === 'available' ? `${sectionBins.response_count} peer ratings across ${dim.all.toLowerCase()}` : undefined}>
        {sectionBins?.availability === 'available' && sectionBins.bins ? <DistributionBars theme={theme} bins={sectionBins.bins} /> : <p className="reports-chart-notice">{sectionBins?.availability === 'suppressed' ? 'Hidden by the privacy threshold.' : 'No rating responses for this section.'}</p>}
      </ChartCard>
    </div>
    {questions}
    {data.trend.length > 1 && <ChartCard title={`${section.name} over time`} subtitle={`Peer rating in recent reportable campaigns · dashed = ${groups.length ? dim.all.toLowerCase() : 'average of all sections'}`}>
      <TrendLines theme={theme} points={trendPoints} series={trendSeries} onSelect={onTrend} />
    </ChartCard>}
  </>;
}

/** How strictly each evaluator role rates colleagues: its average given rating against the campaign average. */
function RaterCalibration({ theme, data }: { theme: ChartTheme; data: CampaignDashboard }) {
  const overall = available(data.overall);
  const rows = (data.raters ?? []).filter((rater) => available(rater.overall) !== null);
  const hidden = (data.raters ?? []).length - rows.length;
  // One evaluator role has nothing to be compared with.
  if (overall === null || (data.raters ?? []).length < 2) return null;
  return <ChartCard title="Rater calibration" subtitle={`Average rating each evaluator role gives, against the campaign average (${overall.toFixed(2)}) · below zero = stricter, above = more generous${hidden ? ` · ${hidden} hidden by the privacy threshold` : ''}`}
    actions={rows.length > 0 ? <CsvButton name={`${data.campaign.name} rater calibration`} rows={() => [['Evaluator role', 'Evaluators', 'Average given', 'Campaign average', 'Difference'], ...rows.map((rater) => [rater.name, rater.evaluator_count, rater.overall.score!.toFixed(2), overall.toFixed(2), (rater.overall.score! - overall).toFixed(2)])]} /> : undefined}>
    {rows.length ? <GapBars theme={theme} rows={rows.map((rater) => ({ id: rater.id, name: rater.name, self: rater.overall.score!, peer: overall }))} labels={{ self: 'Average given', peer: 'Campaign average', gap: 'Difference' }} />
      : <p className="reports-chart-notice">No evaluator role has enough reviewers to be shown.</p>}
    <p className="reports-chart-footnote">A role that rates much lower or higher than the others shifts the scores of the people it reviews; consider it when comparing results.</p>
  </ChartCard>;
}
