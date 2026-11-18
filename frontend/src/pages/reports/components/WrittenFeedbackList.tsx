import { useEffect, useState } from 'react';
import { ApiAccessError, type AccessTokenGetter } from '../../../auth/authenticated-api';
import { fetchWrittenFeedback } from '../api/reports.api';
import type { WrittenFeedbackResponse } from '../types/reports.types';
import LoadError from '../../../components/feedback/LoadError';
import LoadingState from '../../../components/feedback/LoadingState';

export default function WrittenFeedbackList({ campaignId, questionKey, sectionId, employeeId, evaluationType, getAccessToken }: {
  campaignId: number;
  questionKey: string;
  sectionId: number | null;
  employeeId?: number;
  evaluationType: 'peer' | 'self';
  getAccessToken: AccessTokenGetter;
}) {
  const [result, setResult] = useState<{ campaignId: number; employeeId: number | undefined; response: WrittenFeedbackResponse } | null>(null);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError('');
    setDenied(false);
    fetchWrittenFeedback(getAccessToken, campaignId, questionKey, evaluationType,
      { section_id: sectionId ?? undefined, employee_id: employeeId }, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setResult({ campaignId, employeeId, response });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiAccessError && cause.status === 403) setDenied(true);
        else setError(cause instanceof Error ? cause.message : 'Written feedback could not be loaded.');
      });
    return () => controller.abort();
  }, [campaignId, questionKey, sectionId, employeeId, evaluationType, getAccessToken, reload]);

  const label = evaluationType === 'peer' ? 'Peer' : 'Self-evaluation';
  const current = result?.campaignId === campaignId && result.employeeId === employeeId
    && result.response.question_key === questionKey && result.response.evaluation_type === evaluationType
    && result.response.section_id === sectionId && result.response.scope === (employeeId === undefined ? 'campaign' : 'employee') ? result.response : null;
  return <div className="reports-written-feedback" aria-label={`${label} written feedback`}>
    <strong>{label} written feedback</strong>
    {denied ? <p>Written feedback is unavailable for this account.</p>
      : error ? <LoadError message={error} onRetry={() => setReload((value) => value + 1)} />
        : !current ? <LoadingState variant="section" label="Loading responses" />
          : current.availability === 'suppressed' ? <p>Written feedback is unavailable for this question.</p>
            : current.availability === 'not_applicable' ? <p>No {label.toLowerCase()} question was issued for this scope.</p>
              : current.availability === 'no_data' ? <p>No written responses yet</p>
                : <><small>{current.response_count} written {current.response_count === 1 ? 'response' : 'responses'}</small>
                  <div className="reports-written-feedback-cards">{current.responses.map((text, index) => <p className="reports-written-feedback-card" key={index}>{text}</p>)}</div></>}
  </div>;
}
