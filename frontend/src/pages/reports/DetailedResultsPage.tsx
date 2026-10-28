import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { fetchCampaignRatingDistribution, fetchCampaignReportOverview, fetchReportQuestions, fetchSectionComparison } from './api/reports.api';
import { Histogram, HorizontalChart } from './components/OverviewCharts';
import { ChartCard } from './components/ReportCharts';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import type { CampaignRatingDistribution, CampaignReportOverview, ReportQuestion, ReportQuestions, ReportSectionComparison, ReportSectionScore } from './types/reports.types';

const colors = ['#3468cc', '#8061cb', '#1a9d7b', '#4384b8', '#549d89', '#926fb1'];
const sectionRating = (section: ReportSectionScore) => section.availability === 'suppressed' ? 'Restricted' : section.availability === 'no_data' ? 'No data' : section.average_score === null ? 'Unavailable' : `${section.average_score.toFixed(2)} / 5`;

export default function DetailedResultsPage() {
  const { campaignId } = useParams();
  const id = Number(campaignId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(id) && id > 0 ? id : null}>{({ getAccessToken }) => <DetailedContent campaignId={id} getAccessToken={getAccessToken} />}</ReportsLayout>;
}

function ResponseBars({ question, perspective }: { question: ReportQuestion; perspective: 'peer' | 'self' }) {
  const buckets = question.distribution ?? [];
  const width = 420;
  const left = 36;
  const bottom = 113;
  const step = (width - left - 12) / Math.max(1, buckets.length);
  return <div className="reports-svg-wrap"><svg className="reports-svg" viewBox="0 0 420 156" role="img" aria-label={`${perspective} responses by issued rating value, in percent`}>
    {[0, 25, 50, 75, 100].map((value) => { const y = bottom - value * .82; return <g key={value}><line className="reports-svg-grid" x1={left} x2={width - 12} y1={y} y2={y} /><text className="reports-svg-axis" x={left - 6} y={y + 4} textAnchor="end">{value}%</text></g>; })}
    {buckets.map((bucket, index) => { const x = left + index * step + step * .2; const height = bucket.percentage * .82; return <g key={bucket.label}><title>{bucket.label}: {bucket.count} responses ({bucket.percentage}%)</title><rect x={x} y={bottom - height} width={step * .6} height={height} rx={3} fill={perspective === 'peer' ? colors[index % colors.length] : '#8061cb'} /><text className="reports-svg-axis" x={x + step * .3} y={bottom + 16} textAnchor="middle">{bucket.label}</text></g>; })}
    <text className="reports-svg-axis" x={width / 2} y={151} textAnchor="middle">Issued rating ({question.scale_min}–{question.scale_max})</text>
  </svg></div>;
}

function QuestionRow({ question, peer, self, expanded, onToggle }: { question: ReportQuestion; peer?: ReportQuestion; self?: ReportQuestion; expanded: boolean; onToggle: () => void }) {
  const peerDetails = peer?.availability === 'available' && !!peer.distribution?.length;
  const selfDetails = self?.availability === 'available' && !!self.distribution?.length;
  const canExpand = (question.category === 'rating' || question.category === 'choice') && (peerDetails || selfDetails);
  const panelId = `question-panel-${question.key}`;

  function metric(result: ReportQuestion | undefined, perspective: string) {
    if (!result) return null;
    if (result.availability === 'suppressed') return <span className="reports-question-metric"><b>{perspective} ·</b><span className="reports-question-restricted">Restricted</span></span>;
    if (result.availability === 'no_data') return <span className="reports-question-metric"><b>{perspective} ·</b><span className="reports-question-muted">No valid responses</span></span>;
    if (question.category === 'rating' && result.average_normalized !== null) return <span className="reports-question-metric"><b>{perspective} ·</b><strong>{result.average_normalized.toFixed(2)} / 5</strong><small>· {result.response_count} responses</small></span>;
    return <span className="reports-question-metric"><b>{perspective} ·</b><span>{result.response_count} {question.category === 'text' ? 'text responses' : 'responses'}</span></span>;
  }

  return <article className={`reports-question-item${expanded ? ' is-highlighted' : ''}`} id={`question-${question.key}`}>
    <div className="reports-question-summary"><div className="reports-question-identity">{canExpand ? <button type="button" className="reports-question-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={onToggle} title={question.text}>{question.text}</button> : <strong title={question.text}>{question.text}</strong>}<small>{question.type}</small></div><div className="reports-question-values">{metric(peer, 'Peer')}{metric(self, 'Self')}</div><div className="reports-question-action">{canExpand && <button className="reports-question-expand" type="button" aria-label={`${expanded ? 'Hide' : 'Show'} results for ${question.text}`} aria-expanded={expanded} aria-controls={panelId} onClick={onToggle}>{expanded ? 'Hide' : 'Details'}<ChevronDown size={14} className={expanded ? 'is-open' : ''} /></button>}</div></div>
    {canExpand && expanded && <div className="reports-question-panel" id={panelId}><p className="reports-chart-note">{question.category === 'rating' ? 'Bars use the issued rating scale; averages above are normalized to 1–5.' : question.type === 'Multiple choice' ? 'Share selecting each option; respondents can choose more than one.' : 'Share of responses for each option.'}</p><div className={`reports-question-panel-grid${peerDetails && selfDetails ? '' : ' is-single'}`}>{([['Peer', peer], ['Self', self]] as const).map(([perspective, result]) => result?.availability === 'available' && result.distribution?.length ? <div key={perspective} className={`reports-question-panel-chart is-${perspective.toLowerCase()}`}><h3>{perspective} {question.category === 'rating' ? 'ratings' : 'answers'} <span>{result.response_count} responses</span></h3>{question.category === 'rating' ? <ResponseBars question={result} perspective={perspective === 'Peer' ? 'peer' : 'self'} /> : <div className="reports-question-options">{result.distribution.map((bucket) => <div className="reports-question-option-row" key={bucket.label} title={`${bucket.label}: ${bucket.count} responses (${bucket.percentage}%)`}><span>{bucket.label}</span><div className="reports-bar-track" aria-hidden="true"><span style={{ width: `${bucket.percentage}%` }} /></div><strong>{bucket.percentage}% <small>({bucket.count})</small></strong></div>)}</div>}</div> : null)}</div></div>}
  </article>;
}

function DetailedContent({ campaignId, getAccessToken }: { campaignId: number; getAccessToken: AccessTokenGetter | undefined }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<CampaignReportOverview | null>(null);
  const [peer, setPeer] = useState<ReportQuestions | null>(null);
  const [self, setSelf] = useState<ReportQuestions | null>(null);
  const [distribution, setDistribution] = useState<CampaignRatingDistribution | null>(null);
  const [comparisons, setComparisons] = useState<Record<string, ReportSectionComparison>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'highest' | 'lowest' | 'name'>('highest');
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const sectionId = params.get('section');
  const questionKey = params.get('question');
  const groupId = Number(params.get('group_id')) || undefined;
  const roleId = Number(params.get('role_id')) || undefined;
  const employeeId = Number(params.get('employee_id')) || undefined;
  const scoped = !!(groupId || roleId || employeeId);
  const comparisonKey = `${campaignId}:${sectionId}`;
  const comparison = comparisons[comparisonKey];

  useEffect(() => {
    const token = tokenRef.current;
    if (!token || !Number.isSafeInteger(campaignId) || campaignId <= 0) return undefined;
    const controller = new AbortController();
    setError(''); setOverview(null); setPeer(null); setSelf(null); setDistribution(null);
    Promise.all([fetchCampaignReportOverview(token, campaignId, controller.signal), fetchReportQuestions(token, campaignId, { group_id: groupId, role_id: roleId, employee_id: employeeId }, 'peer', controller.signal), fetchReportQuestions(token, campaignId, { group_id: groupId, role_id: roleId, employee_id: employeeId }, 'self', controller.signal)])
      .then(([summary, peerResults, selfResults]) => { if (!controller.signal.aborted) { setOverview(summary); setPeer(peerResults); setSelf(selfResults); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Detailed results could not be loaded.'); });
    if (!scoped) fetchCampaignRatingDistribution(token, campaignId, controller.signal).then((result) => { if (!controller.signal.aborted) setDistribution(result); }).catch(() => {});
    return () => controller.abort();
  }, [campaignId, !!getAccessToken, groupId, roleId, employeeId, reload]);

  useEffect(() => {
    const token = tokenRef.current;
    const id = Number(sectionId);
    if (!token || scoped || !sectionId || !Number.isSafeInteger(id) || id <= 0 || comparison) return undefined;
    const controller = new AbortController();
    fetchSectionComparison(token, campaignId, id, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setComparisons((current) => ({ ...current, [comparisonKey]: result })); })
      .catch(() => {});
    return () => controller.abort();
  }, [campaignId, sectionId, scoped, !!getAccessToken, comparison]);

  const base = `/reports/campaigns/${campaignId}`;
  function destination(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value); }
    const query = next.toString();
    return `${base}/detailed${query ? `?${query}` : ''}`;
  }
  function go(changes: Record<string, string | null>) { navigate(destination(changes)); }
  function toggleQuestion(key: string) {
    if (questionKey === key) {
      setExpanded((current) => current.filter((item) => item !== key));
      navigate(destination({ question: null }), { replace: true });
    } else setExpanded((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  if (error) return <div className="reports-state reports-error" role="alert">{error}<button className="btn btn-secondary" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;
  if (!overview || !peer || !self || overview.campaign.id !== campaignId) return <div className="reports-state">Loading detailed results...</div>;
  const sections = overview.sections;
  const selected = sectionId === null ? null : sections.find((section) => String(section.id) === sectionId);

  if (sectionId !== null && !selected) return <div className="reports-overview"><div className="reports-crumbs"><Link to={destination({ section: null, question: null })}>Detailed Results</Link></div><ReportsEmptyState title="Section not found" message="This section is not part of the current campaign report." /></div>;

  if (selected) {
    const peerQuestions = peer.questions.filter((question) => question.section_id === selected.id);
    const selfQuestions = self.questions.filter((question) => question.section_id === selected.id);
    const questions = [...peerQuestions];
    for (const question of selfQuestions) if (!questions.some((item) => item.key === question.key)) questions.push(question);
    const reportable = peerQuestions.filter((question) => question.category === 'rating' && question.availability === 'available' && question.average_normalized !== null);
    const sectionDistribution = distribution?.sections.find((item) => item.section_id === selected.id);
    const groupComparison = comparison?.groups ?? [];
    const roleComparison = comparison?.roles ?? [];
    return <div className="reports-overview reports-detailed-page reports-selected-section"><div className="reports-crumbs"><Link to={destination({ section: null, question: null })}>Detailed Results</Link><span>/</span><strong>{selected.name}</strong></div><div className="reports-detail-top"><Link to={destination({ section: null, question: null })}>← Back to all sections</Link><label>Section <select aria-label="Select section" value={selected.id} onChange={(event) => go({ section: event.target.value, question: null })}>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label></div><header className="reports-detail-heading"><h2>{selected.name}</h2></header>{scoped && <div className="reports-question-scope"><span>Question results are scoped; section scores and coverage cover the campaign.</span><Link to={`${base}/detailed?section=${selected.id}`}>Clear scope</Link></div>}
      <div className="reports-detail-metrics"><div className="reports-card"><span>Average peer rating</span><strong>{sectionRating(selected)}</strong><small>Employee-balanced section score</small></div><div className="reports-card"><span>Peer coverage</span><strong>{selected.availability === 'suppressed' ? 'Restricted' : selected.availability === 'no_data' ? 'No data' : selected.evaluatee_count}</strong><small>Evaluated employees</small></div><div className="reports-card"><span>Issued questions</span><strong>{selected.question_count ?? 'Unavailable'}</strong><small>In this section</small></div></div>
      {selected.availability === 'suppressed' && <p className="reports-section-privacy-note">Section-level results are restricted by privacy rules. Some question-level statistics may still be available.</p>}
      {((!scoped && sectionDistribution?.availability === 'available' && sectionDistribution.bins) || reportable.length > 0) && <div className="reports-chart-grid reports-detail-charts">{!scoped && sectionDistribution?.availability === 'available' && sectionDistribution.bins && <section key="distribution" className="reports-card reports-detailed-chart"><h3>Section Rating Distribution <span className="reports-info-icon" tabIndex={0} title={distribution?.notes} aria-label={distribution?.notes}><Info size={15} /></span></h3><p className="reports-chart-note">Based on {sectionDistribution.response_count} peer ratings</p><Histogram compact buckets={sectionDistribution.bins} /></section>}{reportable.length > 0 && <section key="questions" className="reports-card reports-detailed-chart"><h3>Question Averages <span className="reports-info-icon" tabIndex={0} title="Each bar averages valid peer responses to one question, normalized to 1–5. These are not employee-balanced section scores." aria-label="Question response averages, not section scores"><Info size={15} /></span></h3><HorizontalChart multiline axisLabel="Peer question average (1–5)" series={reportable.map((question) => ({ id: question.key, label: question.text, value: question.average_normalized, color: colors[questions.findIndex((item) => item.key === question.key) % colors.length], href: `${destination({ question: question.key })}#question-${question.key}` }))} /></section>}</div>}
      <section className="reports-card reports-question-list"><div className="reports-section-heading"><h2>Questions</h2><p>Question averages reflect responses; the section score above balances evaluated employees.</p></div>{questions.length === 0 ? <p className="reports-subtle-state">No issued question results are available for this section yet.</p> : <div className="reports-question-items">{questions.map((question) => <QuestionRow key={question.key} question={question} peer={peerQuestions.find((item) => item.key === question.key)} self={selfQuestions.find((item) => item.key === question.key)} expanded={expanded.includes(question.key) || questionKey === question.key} onToggle={() => toggleQuestion(question.key)} />)}</div>}{questions.some((question) => question.category === 'text') && <p className="reports-chart-note">Written response counts are shown when permitted. Individual comments are not available in this report.</p>}</section>
      {!scoped && (groupComparison.length > 1 || roleComparison.length > 1) && <div className="reports-chart-grid reports-detail-charts">{groupComparison.length > 1 && <section className="reports-card reports-detailed-chart"><h3>Rating by Group</h3><HorizontalChart legend axisLabel="Peer section rating (1–5)" series={groupComparison.map((group, index) => ({ id: String(group.id), label: group.name, value: group.average_score, color: colors[index % colors.length], href: `${base}/groups/${group.id}` }))} /></section>}{roleComparison.length > 1 && <section className="reports-card reports-detailed-chart"><h3>Rating by Role</h3><HorizontalChart legend axisLabel="Peer section rating (1–5)" series={roleComparison.map((role, index) => ({ id: String(role.id), label: role.name, value: role.average_score, color: colors[index % colors.length], href: `${base}/roles/${role.id}` }))} /></section>}</div>}
    </div>;
  }

  const filtered = [...sections].filter((section) => section.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : a.average_score === null ? 1 : b.average_score === null ? -1 : sort === 'lowest' ? a.average_score - b.average_score || a.name.localeCompare(b.name) : b.average_score - a.average_score || a.name.localeCompare(b.name));
  const chartSections = filtered.filter((section) => section.availability === 'available' && section.average_score !== null).slice(0, 8);
  return <div className="reports-overview reports-detailed-page">
    <div className="reports-crumbs"><Link to={base}>Overview</Link><span>/</span><strong>Detailed Results</strong></div>
    <div className="reports-detail-intro"><h2>All Sections</h2><p>Explore each section's peer ratings and question results.</p></div>
    {scoped && <div className="reports-question-scope"><span>Question results are scoped; section scores cover the whole campaign.</span><Link to={`${base}/detailed`}>Clear scope</Link></div>}
    <div className="reports-detail-filters"><input type="search" aria-label="Search sections" placeholder="Search sections" value={search} onChange={(event) => setSearch(event.target.value)} /><select aria-label="Sort sections" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="highest">Highest rating</option><option value="lowest">Lowest rating</option><option value="name">Name A–Z</option></select></div>
    <div className={chartSections.length ? 'reports-chart-grid reports-detail-upper' : 'reports-detail-upper'}>
      <section className="reports-card reports-simple-table"><div className="reports-section-heading"><h2>Section Results</h2></div>{sections.length === 0 ? <p className="reports-subtle-state">No issued rated sections are available for this campaign.</p> : filtered.length === 0 ? <p className="reports-subtle-state">No sections match your search.</p> : <div className="reports-table-scroll"><table><thead><tr><th>Section</th><th>Peer avg.</th><th>Coverage</th><th>Questions</th></tr></thead><tbody>{filtered.map((section) => <tr className="reports-clickable-row" role="link" tabIndex={0} key={section.id} onClick={(event) => { if (!(event.target as HTMLElement).closest('a')) go({ section: String(section.id), question: null }); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); go({ section: String(section.id), question: null }); } }}><td><Link to={destination({ section: String(section.id), question: null })}>{section.name}</Link></td><td>{sectionRating(section)}</td><td>{section.availability === 'suppressed' ? 'Restricted' : section.availability === 'no_data' ? 'No data' : `${section.evaluatee_count} employees`}</td><td>{section.question_count ?? 'Unavailable'}</td></tr>)}</tbody></table></div>}</section>
      {chartSections.length > 0 && <ChartCard title="Section Comparison"><HorizontalChart axisLabel="Average peer rating (1–5)" series={chartSections.map((section) => ({ id: String(section.id), label: section.name, value: section.average_score, color: colors[sections.findIndex((item) => item.id === section.id) % colors.length], href: destination({ section: String(section.id), question: null }) }))} />{filtered.length > 8 && <p className="reports-chart-note">Showing up to 8 sections. Select any section from the list.</p>}</ChartCard>}
    </div>
    {chartSections.length === 0 && sections.length > 0 && <p className="reports-subtle-state">{filtered.length === 0 ? 'No reportable section ratings match this view.' : 'No section ratings are available for this view.'}</p>}
  </div>;
}
