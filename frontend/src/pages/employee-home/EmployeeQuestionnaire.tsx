import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { formatUserName, getSidebarUser } from '../layout/sidebar-user';
import type { FormQuestion } from '../forms/forms.api';
import { fetchAssignedQuestionnaire, saveAssignedQuestionnaire, type AssignedQuestionnaire, type QuestionnaireAnswer } from './employee-home.api';
import { campaignStatus } from './employee-home.utils';
import './employee-home.css';
import './employee-questionnaire.css';

type AnswerValue = QuestionnaireAnswer['value'];
type SaveState = 'idle' | 'saved' | 'failed';

function optionsFor(question: FormQuestion) {
  const source = Array.isArray(question.options) ? question.options : Array.isArray(question.choices) ? question.choices : [];
  return source.map((option) => typeof option === 'string' ? { value: option, label: option } : {
    value: option.id ?? option.value ?? option.label,
    label: option.label ?? option.text ?? option.value,
  }).filter((option): option is { value: string; label: string } => typeof option.value === 'string' && typeof option.label === 'string');
}

function scaleMax(question: FormQuestion) {
  return question.type === 'Scale 1-10' ? 10 : 5;
}

function isQuestionAnswered(question: FormQuestion, value: AnswerValue | undefined) {
  if (question.type === 'Scale 1-5' || question.type === 'Scale 1-10') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= scaleMax(question);
  }
  if (question.type === 'Single choice') {
    return typeof value === 'string' && optionsFor(question).some((option) => option.value === value);
  }
  if (question.type === 'Multiple choice') {
    const options = new Set(optionsFor(question).map((option) => option.value));
    return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && options.has(item));
  }
  if (question.type === 'Number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (question.type === 'Date') {
    return typeof value === 'string' && value.trim() !== '';
  }
  return typeof value === 'string' && value.trim() !== '';
}

function QuestionControl({ question, value, readOnly, onChange }: { question: FormQuestion; value: AnswerValue | undefined; readOnly: boolean; onChange: (value: AnswerValue | null) => void }) {
  const inputId = `employee-question-${question.id}`;
  if (question.type === 'Scale 1-5' || question.type === 'Scale 1-10') {
    return <fieldset className="employee-questionnaire-scale"><legend className="sr-only">{question.text}</legend>{Array.from({ length: scaleMax(question) }, (_, index) => index + 1).map((rating) => <label key={rating} className={value === rating ? 'selected' : ''}><input type="radio" name={question.id} checked={value === rating} disabled={readOnly} onChange={() => onChange(rating)} /><span>{rating}</span></label>)}</fieldset>;
  }
  if (question.type === 'Single choice' || question.type === 'Multiple choice') {
    const options = optionsFor(question);
    if (options.length === 0) return <div className="employee-questionnaire-empty-control">No choices configured.</div>;
    return <fieldset className="employee-questionnaire-choice-group"><legend className="sr-only">{question.text}</legend>{options.map((option) => <label key={option.value}><input type={question.type === 'Single choice' ? 'radio' : 'checkbox'} name={question.id} checked={question.type === 'Single choice' ? value === option.value : Array.isArray(value) && value.includes(option.value)} disabled={readOnly} onChange={(event) => onChange(question.type === 'Single choice' ? option.value : event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter((item) => item !== option.value))} /><span>{option.label}</span></label>)}</fieldset>;
  }
  if (question.type === 'File upload') {
    return <p className="employee-questionnaire-empty-control">File upload answers are not supported yet.</p>;
  }
  if (question.type === 'Number' || question.type === 'Date') {
    return <input id={inputId} className="form-control employee-questionnaire-control" aria-label={question.text} type={question.type === 'Number' ? 'number' : 'date'} value={typeof value === 'number' || typeof value === 'string' ? value : ''} disabled={readOnly} onChange={(event) => onChange(event.target.value === '' ? null : question.type === 'Number' ? Number(event.target.value) : event.target.value)} />;
  }
  return <textarea id={inputId} className="form-control employee-questionnaire-control employee-questionnaire-textarea" aria-label={question.text} value={typeof value === 'string' ? value : ''} disabled={readOnly} placeholder="Type your response..." onChange={(event) => onChange(event.target.value)} />;
}

export default function EmployeeQuestionnaire() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = getSidebarUser()?.id;
  const evaluationId = Number(id);
  const [questionnaire, setQuestionnaire] = useState<AssignedQuestionnaire | null>(null);
  const [answers, setAnswers] = useState<QuestionnaireAnswer[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (userId === undefined || !Number.isSafeInteger(evaluationId) || evaluationId <= 0) return;
    const controller = new AbortController();
    fetchAssignedQuestionnaire(userId, evaluationId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setQuestionnaire(result); setAnswers(result.answers); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Questionnaire could not be loaded.'); });
    return () => controller.abort();
  }, [userId, evaluationId]);

  function updateAnswer(questionId: string, value: AnswerValue | null) {
    setAnswers((current) => [
      ...current.filter((answer) => answer.question_id !== questionId),
      ...(value === null || value === '' || Array.isArray(value) && value.length === 0 ? [] : [{ question_id: questionId, value }]),
    ]);
    setDirty(true);
    setSaveState('idle');
    setError('');
  }

  async function save(submit: boolean) {
    if (!questionnaire || userId === undefined || saving) return;
    setSubmitAttempted(submit);
    if (submit && (!questionnaire.questions.length || questionnaire.questions.some((question) => question.required && !isQuestionAnswered(question, answers.find((answer) => answer.question_id === question.id)?.value)))) {
      setError('Answer all required questions before submitting.');
      return;
    }
    if (submit && !window.confirm('Submit evaluation?\n\nOnce submitted, your responses can no longer be edited.')) return;
    setSaving(true);
    setError('');
    try {
      const saved = await saveAssignedQuestionnaire(userId, evaluationId, answers, submit);
      setQuestionnaire(saved);
      setAnswers(saved.answers);
      setDirty(false);
      setSaveState('saved');
      if (submit) navigate('/employee-home');
    } catch (cause) {
      setSaveState('failed');
      setError(cause instanceof Error ? cause.message : 'Questionnaire could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const available = questionnaire !== null && campaignStatus(questionnaire.evaluation) === 'Ongoing';
  const readOnly = questionnaire?.evaluation.finishDate !== null || !available;
  const answeredCount = questionnaire?.questions.filter((question) => isQuestionAnswered(question, answers.find((answer) => answer.question_id === question.id)?.value)).length ?? 0;
  const questionCount = questionnaire?.questions.length ?? 0;
  const progress = questionCount === 0 ? 0 : Math.round((answeredCount / questionCount) * 100);
  const saveLabel = saving ? 'Saving...' : dirty ? 'Unsaved changes' : saveState === 'saved' ? 'All changes saved' : saveState === 'failed' ? 'Save failed' : 'No unsaved changes';

  return <AppLayout activePage="employee-home" pageClassName="employee-home-page">
    <main className="main-content employee-home-main employee-questionnaire-page">
      <div className="employee-questionnaire-shell">
        <Link className="campaign-details-link" to="/employee-home">← Back to your tasks</Link>
        {!questionnaire ? <p className="card card-padded employee-questionnaire-state" role={error ? 'alert' : 'status'}>{error || (userId === undefined || !Number.isSafeInteger(evaluationId) || evaluationId <= 0 ? 'Questionnaire not found.' : 'Loading questionnaire...')}</p> : <>
          <header className="employee-questionnaire-header">
            <p className="employee-questionnaire-context">{questionnaire.evaluation.campaignName} · {questionnaire.evaluation.evaluatorId === questionnaire.evaluation.evaluateeId ? 'Self-evaluation' : 'Evaluation'}</p>
            <h1>{questionnaire.evaluation.formName}</h1>
            <p>Evaluating {formatUserName(questionnaire.evaluation.evaluateeName)}</p>
            {questionnaire.evaluation.formDescription && <p>{questionnaire.evaluation.formDescription}</p>}
          </header>
          {questionnaire.evaluation.finishDate !== null && <p className="card card-padded employee-questionnaire-state" role="status">This questionnaire has already been submitted.</p>}
          {!available && questionnaire.evaluation.finishDate === null && <p className="card card-padded employee-questionnaire-state" role="status">This questionnaire is not currently available.</p>}
          <section className="card employee-questionnaire-progress" aria-label="Questionnaire completion progress">
            <div><strong>{answeredCount} of {questionCount} questions answered</strong><span>{progress}% complete</span></div>
            <div className="employee-questionnaire-progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Questionnaire completion"><span style={{ width: `${progress}%` }} /></div>
          </section>
          <section className="card employee-questionnaire-panel" aria-label="Questionnaire questions">
            {questionnaire.questions.length === 0 ? <div className="employee-questionnaire-empty">This questionnaire has no questions yet.</div> : questionnaire.questions.map((question, index) => {
              const value = answers.find((answer) => answer.question_id === question.id)?.value;
              const hasError = submitAttempted && question.required && !isQuestionAnswered(question, value);
              const errorId = `employee-question-error-${question.id}`;
              return <div className={hasError ? 'employee-questionnaire-question has-error' : 'employee-questionnaire-question'} key={question.id}>
                <div className="employee-questionnaire-question-title"><span>{index + 1}.</span><label htmlFor={`employee-question-${question.id}`}>{question.text || 'Untitled question'} {question.required && <span aria-label="required">*</span>}</label></div>
                {question.helpText.trim() !== '' && <p className="employee-questionnaire-help">{question.helpText}</p>}
                <QuestionControl question={question} value={value} readOnly={readOnly} onChange={(nextValue) => updateAnswer(question.id, nextValue)} />
                {hasError && <p className="employee-questionnaire-error" id={errorId} role="alert">This question is required.</p>}
              </div>;
            })}
          </section>
          {error && <p className="employee-questionnaire-error global" role="alert">{error}</p>}
          {!readOnly && <div className="card employee-questionnaire-actions"><span className={saveState === 'failed' ? 'failed' : ''} role="status">{saveLabel}</span><div><button className="btn btn-secondary" type="button" disabled={saving || !dirty} onClick={() => save(false)}>{saving ? 'Saving...' : 'Save draft'}</button><button className="btn btn-primary" type="button" disabled={saving || !questionnaire.questions.length || questionnaire.questions.some((question) => question.required && question.type === 'File upload')} onClick={() => save(true)}>Submit evaluation</button></div></div>}
        </>}
      </div>
    </main>
  </AppLayout>;
}
