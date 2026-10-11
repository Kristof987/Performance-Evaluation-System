import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { getSidebarUser } from '../layout/sidebar-user';
import type { FormQuestion } from '../forms/forms.api';
import { fetchAssignedQuestionnaire, saveAssignedQuestionnaire, type AssignedQuestionnaire, type QuestionnaireAnswer } from './employee-home.api';
import { campaignStatus } from './employee-home.utils';
import './employee-home.css';
import './employee-questionnaire.css';

function optionsFor(question: FormQuestion) {
  const source = Array.isArray(question.options) ? question.options : Array.isArray(question.choices) ? question.choices : [];
  return source.map((option) => typeof option === 'string' ? { value: option, label: option } : {
    value: option.id ?? option.value ?? option.label,
    label: option.label ?? option.text ?? option.value,
  }).filter((option): option is { value: string; label: string } => typeof option.value === 'string' && typeof option.label === 'string');
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

  useEffect(() => {
    if (userId === undefined || !Number.isSafeInteger(evaluationId) || evaluationId <= 0) return;
    const controller = new AbortController();
    fetchAssignedQuestionnaire(userId, evaluationId, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setQuestionnaire(result); setAnswers(result.answers); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Questionnaire could not be loaded.'); });
    return () => controller.abort();
  }, [userId, evaluationId]);

  function updateAnswer(questionId: string, value: QuestionnaireAnswer['value'] | null) {
    setAnswers((current) => [
      ...current.filter((answer) => answer.question_id !== questionId),
      ...(value === null || value === '' || Array.isArray(value) && value.length === 0 ? [] : [{ question_id: questionId, value }]),
    ]);
    setDirty(true);
    setError('');
  }

  async function save(submit: boolean) {
    if (!questionnaire || userId === undefined || saving) return;
    if (submit && (!questionnaire.questions.length || questionnaire.questions.some((question) => question.required && !answers.some((answer) => answer.question_id === question.id)))) {
      setError('Answer all required questions before submitting.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await saveAssignedQuestionnaire(userId, evaluationId, answers, submit);
      setQuestionnaire(saved);
      setAnswers(saved.answers);
      setDirty(false);
      if (submit) navigate('/employee-home');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Questionnaire could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const available = questionnaire !== null && campaignStatus(questionnaire.evaluation) === 'Ongoing';
  const readOnly = questionnaire?.evaluation.finishDate !== null || !available;
  return <AppLayout activePage="employee-home" pageClassName="employee-home-page">
    <main className="main-content employee-home-main employee-questionnaire">
      <Link to="/employee-home">Back to your tasks</Link>
      {!questionnaire ? <p role={error ? 'alert' : 'status'}>{error || (userId === undefined || !Number.isSafeInteger(evaluationId) || evaluationId <= 0 ? 'Questionnaire not found.' : 'Loading questionnaire...')}</p> : <>
        <header><h1>{questionnaire.evaluation.formName}</h1><p>{questionnaire.evaluation.campaignName} · Evaluating {questionnaire.evaluation.evaluateeName}</p>
          {questionnaire.evaluation.formDescription && <p>{questionnaire.evaluation.formDescription}</p>}</header>
        {questionnaire.evaluation.finishDate !== null && <p role="status">This questionnaire has already been submitted.</p>}
        {!available && questionnaire.evaluation.finishDate === null && <p role="status">This questionnaire is not currently available.</p>}
        <div className="employee-questionnaire-questions">
          {questionnaire.questions.map((question, index) => {
            const value = answers.find((answer) => answer.question_id === question.id)?.value;
            const options = optionsFor(question);
            return <section className="card employee-questionnaire-question" key={question.id}>
              <h2>{index + 1}. {question.text} {question.required && <span aria-label="required">*</span>}</h2>
              {question.helpText && <p>{question.helpText}</p>}
              {question.type.startsWith('Scale 1-') ? <div className="employee-questionnaire-options">{Array.from({ length: question.type === 'Scale 1-10' ? 10 : 5 }, (_, rating) => <label key={rating}><input type="radio" name={question.id} checked={value === rating + 1} disabled={readOnly} onChange={() => updateAnswer(question.id, rating + 1)} />{rating + 1}</label>)}</div>
                : question.type === 'Single choice' || question.type === 'Multiple choice' ? <div className="employee-questionnaire-options">{options.map((option) => <label key={option.value}><input type={question.type === 'Single choice' ? 'radio' : 'checkbox'} name={question.id} checked={question.type === 'Single choice' ? value === option.value : Array.isArray(value) && value.includes(option.value)} disabled={readOnly} onChange={(event) => updateAnswer(question.id, question.type === 'Single choice' ? option.value : event.target.checked ? [...(Array.isArray(value) ? value : []), option.value] : (Array.isArray(value) ? value : []).filter((item) => item !== option.value))} />{option.label}</label>)}</div>
                  : question.type === 'File upload' ? <p>File upload answers are not supported yet.</p>
                    : question.type === 'Text' ? <textarea className="form-control" aria-label={question.text} value={typeof value === 'string' ? value : ''} disabled={readOnly} onChange={(event) => updateAnswer(question.id, event.target.value)} />
                      : <input className="form-control" aria-label={question.text} type={question.type === 'Number' ? 'number' : 'date'} value={typeof value === 'number' || typeof value === 'string' ? value : ''} disabled={readOnly} onChange={(event) => updateAnswer(question.id, event.target.value === '' ? null : question.type === 'Number' ? Number(event.target.value) : event.target.value)} />}
            </section>;
          })}
        </div>
        {error && <p role="alert">{error}</p>}
        {!readOnly && <div className="employee-questionnaire-actions"><span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span><button className="btn btn-secondary" type="button" disabled={saving || !dirty} onClick={() => save(false)}>{saving ? 'Saving...' : 'Save draft'}</button><button className="btn btn-primary" type="button" disabled={saving || !questionnaire.questions.length || questionnaire.questions.some((question) => question.required && question.type === 'File upload')} onClick={() => save(true)}>Submit evaluation</button></div>}
      </>}
    </main>
  </AppLayout>;
}
