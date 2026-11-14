import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AccessTokenGetter } from '../../../auth/authenticated-api';
import { fetchWrittenFeedbackIndex } from '../api/reports.api';
import type { WrittenFeedbackIndex } from '../types/reports.types';
import WrittenFeedbackList from './WrittenFeedbackList';

export default function WrittenFeedbackPreview({ campaignId, employeeId, sectionId, targetList = false, getAccessToken }: {
  campaignId: number;
  employeeId?: number;
  sectionId?: number;
  targetList?: boolean;
  getAccessToken: AccessTokenGetter;
}) {
  const [data, setData] = useState<{ peer: WrittenFeedbackIndex; self: WrittenFeedbackIndex | null } | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const scope = { section_id: sectionId, employee_id: employeeId };
    setData(null);
    setOpen([]);
    setError('');
    Promise.all([
      fetchWrittenFeedbackIndex(getAccessToken, campaignId, 'peer', scope, controller.signal),
      employeeId === undefined ? Promise.resolve(null) : fetchWrittenFeedbackIndex(getAccessToken, campaignId, 'self', scope, controller.signal),
    ]).then(([peer, self]) => { if (!controller.signal.aborted) setData({ peer, self }); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Written feedback could not be loaded.'); });
    return () => controller.abort();
  }, [campaignId, employeeId, sectionId, getAccessToken, reload]);

  if (error) return <div className="reports-state reports-error" role="alert">{error}<button type="button" className="btn btn-secondary" onClick={() => setReload((value) => value + 1)}>Retry</button></div>;
  if (!data) return <div className="reports-state" role="status">Loading written feedback questions...</div>;
  if (targetList) return <section className="reports-card reports-question-list"><h2>Employees</h2><p className="reports-chart-note">Select an evaluated employee to read submitted feedback received by them. Performance statistics become available in Review.</p>
    {data.peer.evaluatees.length ? <div className="reports-written-preview-sections">{data.peer.evaluatees.map((person) => <Link key={person.evaluatee_id} to={`/reports/campaigns/${campaignId}/employees/${person.evaluatee_id}`}>{person.evaluatee_name}</Link>)}</div> : <p>No written responses yet.</p>}
  </section>;
  const peer = new Map(data.peer.questions.map((question) => [question.key, question]));
  const self = new Map(data.self?.questions.map((question) => [question.key, question]) ?? []);
  const questions = [...peer.values()];
  for (const question of self.values()) if (!peer.has(question.key)) questions.push(question);

  if (employeeId === undefined && sectionId === undefined) {
    const sections = new Map<number, string>();
    for (const question of questions) if (question.section_id !== null) sections.set(question.section_id, question.section_name);
    return <section className="reports-card reports-question-list"><h2>Written feedback by section</h2><p className="reports-chart-note">Select an issued section to view its submitted Text answers. Rating statistics become available in Review.</p>
      {sections.size ? <div className="reports-written-preview-sections">{Array.from(sections, ([id, name]) => <Link key={id} to={`/reports/campaigns/${campaignId}/detailed?section=${id}`}>{name}</Link>)}</div> : <p>No written responses yet.</p>}
    </section>;
  }

  return <section className="reports-card reports-question-list"><div className="reports-section-heading"><h2>Question analytics: written feedback</h2><p>Only submitted answers are shown. Peer and Self-evaluation responses are separate; the text itself may identify its author.</p></div>
    {questions.length === 0 ? <p>No written responses yet.</p> : <div className="reports-question-items">{questions.map((question) => {
      const peerCount = peer.get(question.key)?.response_count ?? 0;
      const selfCount = self.get(question.key)?.response_count ?? 0;
      const expanded = open.includes(question.key);
      const hasResponses = peerCount > 0 || selfCount > 0;
      const panelId = `written-preview-${question.key}`;
      return <article key={question.key} className="reports-question-item"><div className="reports-question-summary"><div className="reports-question-identity"><strong>{question.text}</strong><small>Text · {question.section_name}</small></div><div className="reports-question-values"><span className="reports-question-metric"><b>Peer ·</b> {peerCount} written responses</span>{employeeId !== undefined && <span className="reports-question-metric"><b>Self ·</b> {selfCount} written responses</span>}{!hasResponses && <small>No written responses yet</small>}</div><div className="reports-question-action">{hasResponses && <button className="reports-question-expand" type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => setOpen((current) => expanded ? current.filter((key) => key !== question.key) : [...current, question.key])}>{expanded ? 'Hide responses' : 'View responses'}</button>}</div></div>
        {expanded && hasResponses && <div className="reports-question-panel" id={panelId}>{peerCount > 0 && <WrittenFeedbackList campaignId={campaignId} employeeId={employeeId} sectionId={question.section_id} questionKey={question.key} evaluationType="peer" getAccessToken={getAccessToken} />}{selfCount > 0 && <WrittenFeedbackList campaignId={campaignId} employeeId={employeeId} sectionId={question.section_id} questionKey={question.key} evaluationType="self" getAccessToken={getAccessToken} />}</div>}
      </article>;
    })}</div>}
  </section>;
}
