import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import '../hr-home/hr-home.css';
import './forms.css';
import {
  createForm,
  deleteForm,
  fetchForms,
  updateForm,
  type FormQuestion,
  type ReviewForm,
  type ReviewFormValues,
} from './forms.api';

const emptyQuestion = (): FormQuestion => ({
  id: crypto.randomUUID(),
  text: 'New question',
  type: 'Text',
  required: true,
  helpText: '',
});

const emptyForm = (): ReviewFormValues => ({
  name: 'Untitled form',
  description: '',
  questions: [emptyQuestion()],
});

function normalizeForm(form: ReviewFormValues) {
  return JSON.stringify({
    name: form.name,
    description: form.description,
    questions: form.questions.map(({ text, type, required, helpText }) => ({
      text,
      type,
      required,
      helpText,
    })),
  });
}

const templates: ReviewFormValues[] = [
  {
    name: 'Manager feedback',
    description: 'Template for manager-to-employee feedback.',
    questions: [
      {
        id: crypto.randomUUID(),
        text: 'What did this employee do especially well?',
        type: 'Text',
        required: true,
        helpText: '',
      },
      {
        id: crypto.randomUUID(),
        text: 'How would you rate goal achievement?',
        type: 'Scale 1-5',
        required: true,
        helpText: 'Consider goals agreed at the beginning of the cycle.',
      },
    ],
  },
  {
    name: 'Engagement survey',
    description: 'Template for lightweight employee engagement checks.',
    questions: [
      {
        id: crypto.randomUUID(),
        text: 'How engaged do you feel at work?',
        type: 'Scale 1-5',
        required: true,
        helpText: '',
      },
      {
        id: crypto.randomUUID(),
        text: 'What would improve your work experience?',
        type: 'Text',
        required: false,
        helpText: '',
      },
    ],
  },
];

export default function Forms() {
  const [forms, setForms] = useState<ReviewForm[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReviewFormValues>(emptyForm);
  const [savedDraft, setSavedDraft] = useState<ReviewFormValues>(emptyForm);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    draft.questions[0].id,
  );
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [isLoadingForms, setIsLoadingForms] = useState(true);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [formsMessage, setFormsMessage] = useState('');
  const selectedQuestion =
    draft.questions.find((question) => question.id === selectedQuestionId) ??
    draft.questions[0] ??
    null;
  const hasUnsavedChanges = normalizeForm(draft) !== normalizeForm(savedDraft);

  useEffect(() => {
    const controller = new AbortController();
    fetchForms(controller.signal)
      .then((loadedForms) => {
        if (controller.signal.aborted) return;
        setForms(loadedForms);
        if (loadedForms.length > 0) selectForm(loadedForms[0]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFormsMessage('Forms could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingForms(false);
      });
    return () => controller.abort();
  }, []);

  function selectForm(form: ReviewForm) {
    const nextDraft = {
      name: form.name,
      description: form.description,
      questions: form.questions.length > 0 ? form.questions : [emptyQuestion()],
    };
    setSelectedFormId(form.id);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSelectedQuestionId(nextDraft.questions[0].id);
    setFormsMessage('');
  }

  function startNewForm(form: ReviewFormValues = emptyForm()) {
    const nextForm = {
      ...form,
      questions: form.questions.length > 0 ? form.questions : [emptyQuestion()],
    };
    setSelectedFormId(null);
    setDraft(nextForm);
    setSavedDraft(emptyForm());
    setSelectedQuestionId(nextForm.questions[0].id);
    setFormsMessage('');
  }

  function discardChanges() {
    setDraft(savedDraft);
    setSelectedQuestionId(savedDraft.questions[0]?.id ?? crypto.randomUUID());
    setFormsMessage('Changes discarded.');
  }

  function getUniqueFormName(baseName: string) {
    const existingNames = new Set(
      forms.map((form) => form.name.trim().toLowerCase()),
    );
    if (!existingNames.has(baseName.trim().toLowerCase())) return baseName;

    let counter = 1;
    let candidate = `${baseName} ${counter}`;
    while (existingNames.has(candidate.trim().toLowerCase())) {
      counter += 1;
      candidate = `${baseName} ${counter}`;
    }
    return candidate;
  }

  function startFromTemplate(template: ReviewFormValues) {
    startNewForm({
      ...template,
      name: getUniqueFormName(template.name),
      questions: template.questions.map((question) => ({
        ...question,
        id: crypto.randomUUID(),
      })),
    });
  }

  function updateDraftQuestion(questionId: string, patch: Partial<FormQuestion>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    }));
    setFormsMessage('');
  }

  function addQuestion() {
    const question = emptyQuestion();
    setDraft((current) => ({
      ...current,
      questions: [...current.questions, question],
    }));
    setSelectedQuestionId(question.id);
  }

  function deleteQuestion() {
    if (!selectedQuestion || draft.questions.length === 1) return;
    const remaining = draft.questions.filter(
      (question) => question.id !== selectedQuestion.id,
    );
    setDraft((current) => ({ ...current, questions: remaining }));
    setSelectedQuestionId(remaining[0].id);
  }

  function reorderQuestion(targetQuestionId: string) {
    if (draggedQuestionId === null || draggedQuestionId === targetQuestionId) return;
    setDraft((current) => {
      const fromIndex = current.questions.findIndex(
        (question) => question.id === draggedQuestionId,
      );
      const toIndex = current.questions.findIndex(
        (question) => question.id === targetQuestionId,
      );
      if (fromIndex === -1 || toIndex === -1) return current;
      const questions = [...current.questions];
      const [movedQuestion] = questions.splice(fromIndex, 1);
      questions.splice(toIndex, 0, movedQuestion);
      return { ...current, questions };
    });
    setDraggedQuestionId(null);
  }

  async function saveForm() {
    if (isSavingForm) return;
    if (draft.name.trim() === '') {
      setFormsMessage('Form title is required.');
      return;
    }
    if (
      forms.some(
        (form) =>
          form.id !== selectedFormId &&
          form.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
      )
    ) {
      setFormsMessage('Form name already exists.');
      return;
    }
    if (draft.questions.some((question) => question.text.trim() === '')) {
      setFormsMessage('Every question needs text.');
      return;
    }

    setIsSavingForm(true);
    setFormsMessage('');
    const questionIdBeforeSave = selectedQuestionId;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      questions: draft.questions.map((question) => ({
        ...question,
        text: question.text.trim(),
        helpText: question.helpText.trim(),
      })),
    };
    try {
      const saved = selectedFormId === null
        ? await createForm(payload)
        : await updateForm(selectedFormId, payload);
      setForms((current) => {
        const exists = current.some((form) => form.id === saved.id);
        return exists
          ? current.map((form) => (form.id === saved.id ? saved : form))
          : [saved, ...current];
      });
      selectForm(saved);
      setSelectedQuestionId(
        saved.questions.some((question) => question.id === questionIdBeforeSave)
          ? questionIdBeforeSave
          : saved.questions[0]?.id ?? crypto.randomUUID(),
      );
      setSavedDraft({
        name: saved.name,
        description: saved.description,
        questions: saved.questions,
      });
      setFormsMessage('Form saved successfully.');
    } catch (error) {
      setFormsMessage(error instanceof Error ? error.message : 'Form could not be saved.');
    } finally {
      setIsSavingForm(false);
    }
  }

  async function removeForm() {
    if (selectedFormId === null || isSavingForm) return;
    setIsSavingForm(true);
    setFormsMessage('');
    try {
      await deleteForm(selectedFormId);
      const remaining = forms.filter((form) => form.id !== selectedFormId);
      setForms(remaining);
      if (remaining.length > 0) selectForm(remaining[0]);
      else startNewForm();
      setFormsMessage('Form deleted.');
    } catch (error) {
      setFormsMessage(error instanceof Error ? error.message : 'Form could not be deleted.');
    } finally {
      setIsSavingForm(false);
    }
  }

  return (
    <AppLayout activePage="forms" pageClassName="forms-page">
      <div className="main-content forms-editor-main">
        <section className="forms-editor-hello">
          <h1>Form editor</h1>
          <p>Create reusable questionnaires only. Campaign assignment happens elsewhere.</p>
        </section>

        <section className="forms-editor-page-head">
          <div className="forms-editor-title">
            <h2>Questionnaire builder</h2>
            <p>Build reusable questions and save them to the database.</p>
          </div>
        </section>

        <section className="forms-editor-workspace">
          <aside className="card forms-editor-card forms-list-panel">
            <div className="forms-editor-card-head">
              <h3>Forms</h3>
              <div className="forms-list-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={saveForm}
                  disabled={isSavingForm || !hasUnsavedChanges}
                >
                  {isSavingForm ? 'Saving...' : 'Save'}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={discardChanges}
                  disabled={isSavingForm || !hasUnsavedChanges}
                >
                  Discard
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => startNewForm()}>
                  Create
                </button>
                <button
                  className="btn btn-secondary forms-danger-action"
                  type="button"
                  onClick={removeForm}
                  disabled={selectedFormId === null || isSavingForm}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="forms-editor-list">
              {isLoadingForms && <div className="forms-editor-state">Loading forms...</div>}
              {!isLoadingForms && forms.length === 0 && (
                <div className="forms-editor-state">No forms have been added yet.</div>
              )}
              {forms.map((form) => (
                <button
                  className={`forms-editor-form-item${selectedFormId === form.id ? ' active' : ''}`}
                  key={form.id}
                  type="button"
                  onClick={() => selectForm(form)}
                >
                  <strong>{form.name}</strong>
                  <span>{form.questions.length} questions</span>
                </button>
              ))}
            </div>
            <div className="forms-editor-card-head">
              <div>
                <h3>Templates</h3>
                <span>Reusable starting points for new forms.</span>
              </div>
            </div>
            <div className="forms-editor-list">
              {templates.map((template) => (
                <button
                  className="forms-editor-template-item"
                  key={template.name}
                  type="button"
                  onClick={() => startFromTemplate(template)}
                >
                  <strong>{template.name}</strong>
                  <span>Use and customize</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="card forms-editor-card forms-editor-panel">
            <div className="forms-editor-form-title">
              <input
                className="form-control"
                aria-label="Form title"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
              <textarea
                className="form-control"
                aria-label="Form description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
              {formsMessage !== '' && (
                <div
                  className={`forms-editor-message${formsMessage.toLowerCase().includes('success') || formsMessage.toLowerCase().includes('saved') ? ' success' : ''}`}
                >
                  {formsMessage}
                </div>
              )}
            </div>

            <div className="forms-editor-section">
              <div className="forms-editor-section-head">
                <h3>Questions</h3>
                <button className="btn btn-secondary" type="button" onClick={addQuestion}>
                  Add question
                </button>
              </div>
              {draft.questions.map((question) => (
                <Question
                  key={question.id}
                  active={selectedQuestionId === question.id}
                  title={question.text}
                  meta={`${question.type} question${question.helpText ? ' · Help text enabled' : ''}`}
                  pills={[question.required ? 'Required' : 'Optional', question.type]}
                  mutedFirst={!question.required}
                  onClick={() => setSelectedQuestionId(question.id)}
                  onDragStart={() => {
                    setDraggedQuestionId(question.id);
                    setSelectedQuestionId(question.id);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderQuestion(question.id)}
                  onDragEnd={() => setDraggedQuestionId(null)}
                />
              ))}
              <div className="forms-editor-add-row">
                <button className="btn btn-secondary" type="button" onClick={addQuestion}>
                  Add question
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={deleteQuestion}
                  disabled={draft.questions.length === 1}
                >
                  Delete question
                </button>
              </div>
            </div>
          </section>

          <aside className="card forms-editor-card forms-editor-settings-panel">
            <div className="forms-editor-card-head">
              <h3>Question settings</h3>
            </div>
            {selectedQuestion ? (
              <div className="forms-editor-props">
                <div className="form-field forms-editor-field">
                  <label className="form-label" htmlFor="forms-question-text">Question text</label>
                  <textarea
                    id="forms-question-text"
                    className="form-control"
                    value={selectedQuestion.text}
                    onChange={(event) =>
                      updateDraftQuestion(selectedQuestion.id, { text: event.target.value })
                    }
                  />
                </div>
                <div className="form-field forms-editor-field">
                  <label className="form-label" htmlFor="forms-question-type">Question type</label>
                  <select
                    id="forms-question-type"
                    className="form-control"
                    value={selectedQuestion.type}
                    onChange={(event) =>
                      updateDraftQuestion(selectedQuestion.id, { type: event.target.value })
                    }
                  >
                    <option>Scale 1-5</option>
                    <option>Scale 1-10</option>
                    <option>Text</option>
                    <option>Number</option>
                    <option>Single choice</option>
                    <option>Multiple choice</option>
                    <option>Date</option>
                    <option>File upload</option>
                  </select>
                </div>
                <label className="forms-editor-switch">
                  <span>Required question</span>
                  <input
                    type="checkbox"
                    checked={selectedQuestion.required}
                    onChange={(event) =>
                      updateDraftQuestion(selectedQuestion.id, { required: event.target.checked })
                    }
                  />
                </label>
                <div className="form-field forms-editor-field">
                  <label className="form-label" htmlFor="forms-help-text">Help text</label>
                  <textarea
                    id="forms-help-text"
                    className="form-control"
                    value={selectedQuestion.helpText}
                    onChange={(event) =>
                      updateDraftQuestion(selectedQuestion.id, { helpText: event.target.value })
                    }
                  />
                </div>
                <div className="forms-editor-note">
                  Saved questions are stored in the database as the form's question JSON.
                </div>
              </div>
            ) : (
              <div className="forms-editor-state">Select a question to edit it.</div>
            )}
          </aside>
        </section>
      </div>
    </AppLayout>
  );
}

type QuestionProps = {
  title: string;
  meta: string;
  pills: string[];
  active?: boolean;
  mutedFirst?: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function Question({
  title,
  meta,
  pills,
  active = false,
  mutedFirst = false,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: QuestionProps) {
  return (
    <button
      className={`card forms-editor-question${active ? ' active' : ''}`}
      type="button"
      onClick={onClick}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="forms-editor-drag"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
      >
        ⋮⋮
      </div>
      <div className="forms-editor-q-main">
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="forms-editor-q-meta">
        {pills.map((pill, index) => (
          <span
            key={pill}
            className={`badge ${mutedFirst || index > 0 ? 'badge-neutral' : 'badge-primary'}`}
          >
            {pill}
          </span>
        ))}
      </div>
    </button>
  );
}
