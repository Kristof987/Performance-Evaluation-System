import { useEffect, useRef, useState } from 'react';
import { ApiAccessError, type AccessTokenGetter } from '../../../auth/authenticated-api';
import { fetchEvaluationQuality } from '../api/reports.api';
import type { EvaluationQualityCategory, EvaluationQualityFinding, EvaluationQualityReport } from '../types/reports.types';
import ReportsLoadError from './ReportsLoadError';

const categories: Array<{ key: EvaluationQualityCategory; label: string }> = [
  { key: 'uniform_rating_pattern', label: 'Uniform rating patterns' },
  { key: 'higher_rating_tendency', label: 'Higher rating tendencies' },
  { key: 'lower_rating_tendency', label: 'Lower rating tendencies' },
  { key: 'peer_rating_disagreement', label: 'Peer rating disagreement' },
  { key: 'rating_distribution_concentration', label: 'Rating distribution concentration' },
];

const evidenceLabels: Record<string, string> = {
  mean_distinct_original_values: 'Average distinct ratings',
  mean_normalized_standard_deviation: 'Average rating spread',
  mean_modal_percentage: 'Average most-common rating share',
  mean_issued_maximum_percentage: 'Average issued-maximum share',
  mean_absolute_peer_difference: 'Average peer difference',
  large_difference_percentage: 'Large differences',
  wide_range_group_percentage: 'Wide-range question groups',
  mean_group_range: 'Average question-group range',
  issued_maximum_percentage: 'At issued maximum',
  modal_percentage: 'Most common rating share',
  normalized_standard_deviation: 'Rating spread',
};

function EvaluationQualityStatus({ status }: { status: EvaluationQualityReport['analysis_status'] }) {
  return <span className={`quality-summary-status ${status === 'final' ? 'is-final' : ''}`}>{status === 'final' ? 'Final' : status === 'preliminary' ? 'Preliminary' : 'Unavailable'}</span>;
}

export function EvaluationQualityObservation({ finding, final }: { finding: EvaluationQualityFinding; final: boolean }) {
  const evidence = final ? Object.entries(finding.statistics) : [];
  return <li className="quality-summary-finding">
    <div className="quality-summary-finding-heading"><strong>{finding.title}</strong><span>{finding.scope === 'campaign' ? 'Campaign-wide' : finding.scope}</span></div>
    <p>{finding.description}</p>
    {final && (finding.eligible_observations !== null || evidence.length > 0) && <details>
      <summary>Released statistical evidence</summary>
      <div className="quality-summary-evidence">
        {finding.eligible_observations !== null && <span>{finding.eligible_observations} eligible observations</span>}
        {evidence.map(([name, value]) => <span key={name}>{evidenceLabels[name] ?? name.replace(/_/g, ' ')}: {value}{name.endsWith('percentage') ? '%' : ''}</span>)}
      </div>
      <p>{finding.method} {finding.rule}</p>
    </details>}
  </li>;
}

function EvaluationQualityEligibility({ report }: { report: EvaluationQualityReport }) {
  const eligible = categories.filter(({ key }) => report.coverage.detectors[key] === 'analyzed').length;
  return <details className="quality-summary-eligibility"><summary>Detection coverage: {eligible} of {categories.length} checks had enough data</summary>
    <ul>{categories.map(({ key, label }) => <li key={key}><span>{label}</span><span>{report.coverage.detectors[key] === 'analyzed' ? 'Enough data' : 'Insufficient data'}</span></li>)}</ul>
  </details>;
}

function QualityContent({ campaignId, getAccessToken }: { campaignId: number; getAccessToken: AccessTokenGetter }) {
  const sectionRef = useRef<HTMLElement>(null);
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const [report, setReport] = useState<EvaluationQualityReport | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error' | 'denied'>('idle');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let started = false;
    setReport(null);
    setStatus('idle');
    setError('');
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      setStatus('loading');
      fetchEvaluationQuality(tokenRef.current, campaignId, controller.signal)
        .then((result) => { if (!controller.signal.aborted) { setReport(result); setStatus('loaded'); } })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          if (cause instanceof ApiAccessError && cause.status === 403) setStatus('denied');
          else { setError(cause instanceof Error ? cause.message : 'Analysis could not be loaded.'); setStatus('error'); }
        });
    };
    if (!sectionRef.current || !('IntersectionObserver' in window)) load();
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); load(); }
      }, { rootMargin: '250px' });
      observer.observe(sectionRef.current);
      return () => { observer.disconnect(); controller.abort(); };
    }
    return () => controller.abort();
  }, [campaignId, reloadKey]);

  if (status === 'denied') return null;
  const current = report?.campaign.id === campaignId ? report : null;
  const findings = current ? categories.flatMap(({ key }) => current.findings_by_category[key] ?? []) : [];
  return <section ref={sectionRef} className="reports-card quality-summary" aria-labelledby="quality-summary-title">
    <div className="quality-summary-heading"><div><h2 id="quality-summary-title">Evaluation Quality</h2><p>Campaign-level patterns in completed, valid peer evaluations. Informational only; scores are unchanged.</p></div>
      {current && <EvaluationQualityStatus status={current.analysis_status} />}
    </div>
    {status === 'idle' || status === 'loading' || status === 'loaded' && !current ? <p className="quality-summary-note" role="status">Loading evaluation quality...</p> : null}
    {status === 'error' && <ReportsLoadError message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
    {current && status === 'loaded' && <>
      {current.analysis_status === 'preliminary' && <p className="quality-summary-note">Preliminary analysis based on completed evaluations. Findings may change as additional reviews are submitted.</p>}
      {current.analysis_status === 'final' && <p className="quality-summary-note">Final analysis based on completed campaign evaluations.</p>}
      {current.data_status === 'no_data' ? <p className="quality-summary-note">{current.completed_peer_reviews === 0 ? 'No completed peer evaluations yet.' : 'No valid completed peer ratings are available for analysis.'}</p>
        : current.data_status === 'insufficient_data' ? <p className="quality-summary-note">Not enough independent comparable reviews for reliable pattern checks. No conclusion can be drawn yet.</p>
          : <>
            <p className="quality-summary-count">{current.findings_count} {current.findings_count === 1 ? 'campaign-level observation' : 'campaign-level observations'}</p>
            {findings.length ? <ul className="quality-summary-findings">{findings.map((finding, index) => <EvaluationQualityObservation key={`${finding.category}-${index}`} finding={finding} final={current.analysis_status === 'final'} />)}</ul>
              : <p className="quality-summary-note">No notable evaluation-quality patterns were detected among eligible observations. This does not establish that every evaluation is reliable or unbiased.</p>}
            <EvaluationQualityEligibility report={current} />
          </>}
      {current.data_status === 'insufficient_data' && <EvaluationQualityEligibility report={current} />}
      <button type="button" className="reports-text-button quality-summary-refresh" onClick={() => setReloadKey((key) => key + 1)}>Refresh analysis</button>
    </>}
  </section>;
}

export default function EvaluationQualitySummary({ campaignId, actorId, getAccessToken, authorized }: {
  campaignId: number; actorId: number | null; getAccessToken: AccessTokenGetter | undefined; authorized: boolean;
}) {
  if (!authorized || actorId === null || !getAccessToken) return null;
  return <QualityContent key={`${campaignId}-${actorId}`} campaignId={campaignId} getAccessToken={getAccessToken} />;
}
