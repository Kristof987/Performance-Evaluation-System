import { useEffect, useState } from 'react';
import AppLayout from '../layout/AppLayout';
import '../hr-home/hr-home.css';
import './forms.css';
import {
  createForm,
  createFormTemplate,
  deleteForm,
  deleteFormTemplate,
  fetchFormTemplates,
  fetchForms,
  updateForm,
  updateFormTemplate,
  type FormQuestion,
  type ReviewForm,
  type ReviewFormValues,
} from './forms.api';

type EditorMode = 'forms' | 'templates';
type FormCreateSource = 'empty' | 'template';

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

export default function Forms() {
  const [forms, setForms] = useState<ReviewForm[]>([]);
  const [templates, setTemplates] = useState<ReviewForm[]>([]);
  const [editorMode, setEditorMode] = useState<EditorMode>('forms');
  const [formCreateSource, setFormCreateSource] = useState<FormCreateSource>('empty');
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createItemName, setCreateItemName] = useState('Untitled form');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReviewFormValues>(emptyForm);
  const [savedDraft, setSavedDraft] = useState<ReviewFormValues>(emptyForm);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    draft.questions[0].id,
  );
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [isLoadingForms, setIsLoadingForms] = useState(true);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [formsMessage, setFormsMessage] = useState('');
  const selectedQuestion =
    draft.questions.find((question) => question.id === selectedQuestionId) ??
    draft.questions[0] ??
    null;
  const hasUnsavedChanges = normalizeForm(draft) !== normalizeForm(savedDraft);
  const activeItems = editorMode === 'forms' ? forms : templates;
  const isLoadingActiveItems = editorMode === 'forms' ? isLoadingForms : isLoadingTemplates;
  const activeItemLabel = editorMode === 'forms' ? 'Form' : 'Template';
  const activeItemLabelLower = activeItemLabel.toLowerCase();

  useEffect(() => {
    const controller = new AbortController();
    fetchForms(controller.signal)
      .then((loadedForms) => {
        if (controller.signal.aborted) return;
        setForms(loadedForms);
        if (loadedForms.length > 0) selectItem(loadedForms[0]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFormsMessage('Forms could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingForms(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchFormTemplates(controller.signal)
      .then((loadedTemplates) => {
        if (controller.signal.aborted) return;
        setTemplates(loadedTemplates);
        setSelectedTemplateId((current) => current ?? loadedTemplates[0]?.id ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFormsMessage('Templates could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingTemplates(false);
      });
    return () => controller.abort();
  }, []);

  function selectItem(form: ReviewForm) {
    const nextDraft = {
      name: form.name,
      description: form.description,
      questions: form.questions.length > 0 ? form.questions : [emptyQuestion()],
    };
    setSelectedItemId(form.id);
    setDraft(nextDraft);
    setSavedDraft(nextDraft);
    setSelectedQuestionId(nextDraft.questions[0].id);
    setFormsMessage('');
  }

  function startNewItem(form: ReviewFormValues = emptyForm()) {
    const nextForm = {
      ...form,
      questions: form.questions.length > 0 ? form.questions : [emptyQuestion()],
    };
    setSelectedItemId(null);
    setDraft(nextForm);
    setSavedDraft(emptyForm());
    setSelectedQuestionId(nextForm.questions[0].id);
    setFormsMessage('');
  }

  function switchMode(mode: EditorMode) {
    setEditorMode(mode);
    const nextItems = mode === 'forms' ? forms : templates;
    if (nextItems.length > 0) selectItem(nextItems[0]);
    else startNewItem({
      ...emptyForm(),
      name: mode === 'forms' ? 'Untitled form' : 'Untitled template',
    });
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

  function startFromTemplate(template: ReviewFormValues, name = getUniqueFormName(template.name)) {
    if (editorMode !== 'forms') setEditorMode('forms');
    startNewItem({
      ...template,
      name,
      questions: template.questions.map((question) => ({
        ...question,
        id: crypto.randomUUID(),
      })),
    });
  }

  function openCreateModal() {
    setCreateItemName(editorMode === 'forms' ? 'Untitled form' : 'Untitled template');
    setFormCreateSource('empty');
    setSelectedTemplateId((current) => current ?? templates[0]?.id ?? null);
    setFormsMessage('');
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
  }

  function confirmCreateItem() {
    const name = createItemName.trim();
    if (name === '') {
      setFormsMessage(`${activeItemLabel} title is required.`);
      return;
    }

    if (
      activeItems.some((item) => item.name.trim().toLowerCase() === name.toLowerCase())
    ) {
      setFormsMessage(`${activeItemLabel} name already exists.`);
      return;
    }

    if (editorMode === 'forms' && formCreateSource === 'template') {
      const template = templates.find((item) => item.id === selectedTemplateId) ?? templates[0];
      if (template === undefined) {
        setFormsMessage('Choose a template first.');
        return;
      }
      startFromTemplate(template, name);
      closeCreateModal();
      return;
    }

    startNewItem({
      ...emptyForm(),
      name,
    });
    closeCreateModal();
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

  async function saveItem() {
    if (isSavingForm) return;
    if (draft.name.trim() === '') {
      setFormsMessage(`${activeItemLabel} title is required.`);
      return;
    }
    if (
      activeItems.some(
        (form) =>
          form.id !== selectedItemId &&
          form.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
      )
    ) {
      setFormsMessage(`${activeItemLabel} name already exists.`);
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
      const saved = editorMode === 'forms'
        ? selectedItemId === null
          ? await createForm(payload)
          : await updateForm(selectedItemId, payload)
        : selectedItemId === null
          ? await createFormTemplate(payload)
          : await updateFormTemplate(selectedItemId, payload);
      const updateCollection = (current: ReviewForm[]) => {
        const exists = current.some((form) => form.id === saved.id);
        return exists
          ? current.map((form) => (form.id === saved.id ? saved : form))
          : [saved, ...current];
      };
      if (editorMode === 'forms') setForms(updateCollection);
      else setTemplates(updateCollection);
      selectItem(saved);
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
      setFormsMessage(`${activeItemLabel} saved successfully.`);
    } catch (error) {
      setFormsMessage(error instanceof Error ? error.message : `${activeItemLabel} could not be saved.`);
    } finally {
      setIsSavingForm(false);
    }
  }

  async function removeItem() {
    if (selectedItemId === null || isSavingForm) return;
    setIsSavingForm(true);
    setFormsMessage('');
    try {
      if (editorMode === 'forms') await deleteForm(selectedItemId);
      else await deleteFormTemplate(selectedItemId);
      const remaining = activeItems.filter((form) => form.id !== selectedItemId);
      if (editorMode === 'forms') setForms(remaining);
      else setTemplates(remaining);
      if (remaining.length > 0) selectItem(remaining[0]);
      else startNewItem({
        ...emptyForm(),
        name: editorMode === 'forms' ? 'Untitled form' : 'Untitled template',
      });
      setFormsMessage(`${activeItemLabel} deleted.`);
    } catch (error) {
      setFormsMessage(error instanceof Error ? error.message : `${activeItemLabel} could not be deleted.`);
    } finally {
      setIsSavingForm(false);
    }
  }

  return (
    <AppLayout activePage="forms" pageClassName="forms-page">
      <div className="main-content forms-editor-main">
        <section className="forms-editor-hello">
          <h1>Form editor</h1>
          <p>Create reusable questionnaires and templates. Campaign assignment happens elsewhere.</p>
        </section>

        <section className="forms-editor-page-head">
          <div className="forms-editor-title">
            <h2>{activeItemLabel} builder</h2>
            <p>Build reusable questions and save the selected {activeItemLabelLower} to the database.</p>
          </div>
        </section>

        <section className="forms-editor-workspace">
          <aside className="card forms-editor-card forms-list-panel">
            <div className="forms-editor-card-head">
              <div className="forms-list-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={saveItem}
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
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={openCreateModal}
                >
                  Create
                </button>
                <button
                  className="btn btn-secondary forms-danger-action"
                  type="button"
                  onClick={removeItem}
                  disabled={selectedItemId === null || isSavingForm}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="forms-editor-mode-switch" role="tablist" aria-label="Editor mode">
              <button
                className={editorMode === 'forms' ? 'active' : ''}
                type="button"
                onClick={() => switchMode('forms')}
              >
                Forms
              </button>
              <button
                className={editorMode === 'templates' ? 'active' : ''}
                type="button"
                onClick={() => switchMode('templates')}
              >
                Templates
              </button>
            </div>
            <div className="forms-editor-list">
              {isLoadingActiveItems && (
                <div className="forms-editor-state">Loading {activeItemLabelLower}s...</div>
              )}
              {!isLoadingActiveItems && activeItems.length === 0 && (
                <div className="forms-editor-state">No {activeItemLabelLower}s have been added yet.</div>
              )}
              {activeItems.map((form) => (
                <button
                  className={`forms-editor-form-item${selectedItemId === form.id ? ' active' : ''}`}
                  key={form.id}
                  type="button"
                  onClick={() => selectItem(form)}
                >
                  <strong>{form.name}</strong>
                  <span>{form.questions.length} questions</span>
                </button>
              ))}
            </div>
          </aside>

          {isCreateModalOpen && (
            <div className="forms-editor-modal-backdrop" role="presentation">
              <div className="forms-editor-modal" role="dialog" aria-modal="true" aria-labelledby="forms-create-title">
                <div className="forms-editor-modal-head">
                  <div>
                    <h3 id="forms-create-title">Create {activeItemLabelLower}</h3>
                    <p>Name the new {activeItemLabelLower} before editing its questions.</p>
                  </div>
                  <button className="forms-editor-modal-close" type="button" onClick={closeCreateModal}>
                    ×
                  </button>
                </div>
                <div className="forms-editor-modal-body">
                  <label className="form-field forms-editor-field" htmlFor="forms-create-name">
                    <span className="form-label">Name</span>
                    <input
                      id="forms-create-name"
                      className="form-control"
                      value={createItemName}
                      onChange={(event) => setCreateItemName(event.target.value)}
                      autoFocus
                    />
                  </label>
                  {editorMode === 'forms' && (
                    <div className="forms-editor-create-options">
                      <div className="forms-editor-create-tabs" aria-label="Create form source">
                        <button
                          className={formCreateSource === 'empty' ? 'active' : ''}
                          type="button"
                          onClick={() => setFormCreateSource('empty')}
                        >
                          Empty form
                        </button>
                        <button
                          className={formCreateSource === 'template' ? 'active' : ''}
                          type="button"
                          onClick={() => setFormCreateSource('template')}
                          disabled={templates.length === 0 && !isLoadingTemplates}
                        >
                          From template
                        </button>
                      </div>
                      {formCreateSource === 'template' && (
                        <select
                          className="form-control forms-editor-template-select"
                          aria-label="Choose a template"
                          value={selectedTemplateId ?? ''}
                          onChange={(event) => setSelectedTemplateId(Number(event.target.value))}
                          disabled={isLoadingTemplates || templates.length === 0}
                        >
                          {isLoadingTemplates && <option value="">Loading templates...</option>}
                          {!isLoadingTemplates && templates.length === 0 && <option value="">No templates</option>}
                          {templates.map((template) => (
                            <option key={template.id} value={template.id}>
                              {template.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  {formsMessage !== '' && (
                    <div className="forms-editor-modal-message">
                      {formsMessage}
                    </div>
                  )}
                </div>
                <div className="forms-editor-modal-actions">
                  <button className="btn btn-secondary" type="button" onClick={closeCreateModal}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="button" onClick={confirmCreateItem}>
                    Create
                  </button>
                </div>
              </div>
            </div>
          )}

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
