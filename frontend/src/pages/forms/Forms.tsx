import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import AppLayout from '../layout/AppLayout';
import '../hr-home/hr-home.css';
import './forms.css';
import {
  createForm,
  createFormFromTemplate,
  createFormTemplate,
  deleteForm,
  deleteFormTemplate,
  fetchFormTemplates,
  fetchForms,
  updateForm,
  updateFormTemplate,
  type FormQuestion,
  type ChoiceOption,
  type ReviewForm,
  type ReviewFormValues,
} from './forms.api';

type EditorMode = 'forms' | 'templates';
type FormCreateSource = 'empty' | 'template';
type PreviewResponse = string | number | boolean | string[];
const choiceQuestionTypes = new Set(['Single choice', 'Multiple choice']);

const emptyQuestion = (): FormQuestion => ({
  id: crypto.randomUUID(),
  text: 'New question',
  type: 'Text',
  required: true,
  helpText: '',
});

const emptyOption = (): ChoiceOption => ({
  id: crypto.randomUUID(),
  label: '',
});

function isChoiceQuestion(question: FormQuestion | null) {
  return question !== null && choiceQuestionTypes.has(question.type);
}

function normalizeChoiceOptions(question: FormQuestion): ChoiceOption[] {
  if (!Array.isArray(question.options)) return [];
  return question.options
    .map((option, index) => {
      if (typeof option === 'string') {
        return { id: `legacy-${index}-${option}`, label: option };
      }
      if (option && typeof option === 'object') {
        const id = 'id' in option && typeof option.id === 'string' ? option.id : `legacy-${index}`;
        const label = 'label' in option && typeof option.label === 'string' ? option.label : '';
        return { id, label };
      }
      return null;
    })
    .filter((option): option is ChoiceOption => option !== null);
}

function validateChoiceOptions(question: FormQuestion) {
  if (!choiceQuestionTypes.has(question.type)) return '';
  const options = normalizeChoiceOptions(question);
  const trimmedLabels = options.map((option) => option.label.trim());
  if (trimmedLabels.length < 2) return 'Add at least two answer options.';
  if (trimmedLabels.some((label) => label === '')) return 'Answer options cannot be empty.';
  const ids = options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) return 'Answer option IDs must be unique.';
  const normalizedLabels = trimmedLabels.map((label) => label.toLowerCase());
  if (new Set(normalizedLabels).size !== normalizedLabels.length) return 'Answer option labels must be unique.';
  return '';
}

function prepareQuestionForSave(question: FormQuestion): FormQuestion {
  const prepared = {
    ...question,
    text: question.text.trim(),
    helpText: question.helpText.trim(),
  };
  if (choiceQuestionTypes.has(prepared.type)) {
    prepared.options = normalizeChoiceOptions(prepared).map((option) => ({
      id: option.id,
      label: option.label.trim(),
    }));
  }
  return prepared;
}

const emptyForm = (): ReviewFormValues => ({
  name: 'Untitled form',
  description: '',
  questions: [emptyQuestion()],
});

function normalizeForm(form: ReviewFormValues) {
  return JSON.stringify({
    name: form.name,
    description: form.description,
    questions: form.questions,
  });
}

function cloneQuestion(question: FormQuestion): FormQuestion {
  return JSON.parse(JSON.stringify(question)) as FormQuestion;
}

function cloneFormValues(form: ReviewFormValues): ReviewFormValues {
  return {
    name: form.name,
    description: form.description,
    questions: form.questions.map(cloneQuestion),
  };
}

function toDraft(form: ReviewForm): ReviewFormValues {
  return {
    name: form.name,
    description: form.description,
    questions: form.questions.map(cloneQuestion),
  };
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
  const [formsSearch, setFormsSearch] = useState('');
  const [templatesSearch, setTemplatesSearch] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>(
    draft.questions[0].id,
  );
  const [draggedQuestionId, setDraggedQuestionId] = useState<string | null>(null);
  const [isLoadingForms, setIsLoadingForms] = useState(true);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewResponses, setPreviewResponses] = useState<Record<string, PreviewResponse>>({});
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [formsMessage, setFormsMessage] = useState('');
  const selectedQuestionIndex = draft.questions.findIndex((question) => question.id === selectedQuestionId);
  const selectedQuestion = selectedQuestionIndex >= 0 ? draft.questions[selectedQuestionIndex] : null;
  const selectedChoiceOptions = selectedQuestion ? normalizeChoiceOptions(selectedQuestion) : [];
  const selectedChoiceOptionsError = selectedQuestion ? validateChoiceOptions(selectedQuestion) : '';
  const hasUnsavedChanges = normalizeForm(draft) !== normalizeForm(savedDraft);
  const activeItems = editorMode === 'forms' ? forms : templates;
  const isLoadingActiveItems = editorMode === 'forms' ? isLoadingForms : isLoadingTemplates;
  const activeItemLabel = editorMode === 'forms' ? 'Form' : 'Template';
  const activeItemLabelLower = activeItemLabel.toLowerCase();
  const activeSearch = editorMode === 'forms' ? formsSearch : templatesSearch;
  const filteredItems = useMemo(() => {
    const query = activeSearch.trim().toLowerCase();
    if (query === '') return activeItems;
    return activeItems.filter((item) => item.name.toLowerCase().includes(query));
  }, [activeItems, activeSearch]);

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

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!isPreviewOpen) return undefined;
    function handlePreviewKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closePreview();
    }
    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [isPreviewOpen]);

  useEffect(() => {
    if (formsMessage === '' || !formsMessage.toLowerCase().includes('success')) return undefined;
    const timeoutId = window.setTimeout(() => setFormsMessage(''), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [formsMessage]);

  function confirmLoseUnsavedChanges() {
    return !hasUnsavedChanges || window.confirm('Discard unsaved changes and continue?');
  }

  function selectItem(form: ReviewForm) {
    const nextDraft = toDraft(form);
    setSelectedItemId(form.id);
    setDraft(nextDraft);
    setSavedDraft(cloneFormValues(nextDraft));
    setSelectedQuestionId(nextDraft.questions[0]?.id ?? '');
    setFormsMessage('');
  }

  function openPreview() {
    setPreviewResponses({});
    setIsPreviewOpen(true);
  }

  function closePreview() {
    setIsPreviewOpen(false);
    setPreviewResponses({});
  }

  function requestSelectItem(form: ReviewForm) {
    if (!confirmLoseUnsavedChanges()) return;
    selectItem(form);
  }

  function startNewItem(form: ReviewFormValues = emptyForm()) {
    const nextForm = {
      ...form,
      questions: form.questions.length > 0 ? form.questions : [emptyQuestion()],
    };
    setSelectedItemId(null);
    setDraft(nextForm);
    setSavedDraft(cloneFormValues(nextForm));
    setSelectedQuestionId(nextForm.questions[0]?.id ?? '');
    setFormsMessage('');
  }

  function switchMode(mode: EditorMode) {
    if (mode === editorMode) return;
    if (!confirmLoseUnsavedChanges()) return;
    setEditorMode(mode);
    const nextItems = mode === 'forms' ? forms : templates;
    if (nextItems.length > 0) selectItem(nextItems[0]);
    else startNewItem({
      ...emptyForm(),
      name: mode === 'forms' ? 'Untitled form' : 'Untitled template',
    });
  }

  function discardChanges() {
    setDraft(cloneFormValues(savedDraft));
    setSelectedQuestionId(savedDraft.questions[0]?.id ?? '');
    setFormsMessage('Changes discarded.');
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

  async function confirmCreateItem() {
    if (isCreatingItem) return;
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
      setIsCreatingItem(true);
      setFormsMessage('');
      try {
        const saved = await createFormFromTemplate(name, template.description, template.id);
        setForms((current) => [saved, ...current]);
        selectItem(saved);
        closeCreateModal();
        setFormsMessage('Form created from template.');
      } catch (error) {
        setFormsMessage(error instanceof Error ? error.message : 'Form could not be created.');
      } finally {
        setIsCreatingItem(false);
      }
      return;
    }

    setIsCreatingItem(true);
    setFormsMessage('');
    try {
      const payload = {
        ...emptyForm(),
        name,
      };
      const saved = editorMode === 'forms'
        ? await createForm(payload)
        : await createFormTemplate({ ...payload, name });
      if (editorMode === 'forms') setForms((current) => [saved, ...current]);
      else setTemplates((current) => [saved, ...current]);
      selectItem(saved);
      closeCreateModal();
      setFormsMessage(`${activeItemLabel} created.`);
    } catch (error) {
      setFormsMessage(error instanceof Error ? error.message : `${activeItemLabel} could not be created.`);
    } finally {
      setIsCreatingItem(false);
    }
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

  function updateQuestionType(questionId: string, type: string) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) => {
        if (question.id !== questionId) return question;
        if (choiceQuestionTypes.has(type) && Array.isArray(question.options)) return { ...question, type };
        if (choiceQuestionTypes.has(type)) return { ...question, type, options: [] };
        return { ...question, type };
      }),
    }));
    setFormsMessage('');
  }

  function updateChoiceOptions(questionId: string, options: ChoiceOption[]) {
    updateDraftQuestion(questionId, { options });
  }

  function addChoiceOption(question: FormQuestion) {
    updateChoiceOptions(question.id, [...normalizeChoiceOptions(question), emptyOption()]);
  }

  function updateChoiceOption(question: FormQuestion, optionId: string, label: string) {
    updateChoiceOptions(
      question.id,
      normalizeChoiceOptions(question).map((option) =>
        option.id === optionId ? { ...option, label } : option,
      ),
    );
  }

  function removeChoiceOption(question: FormQuestion, optionId: string) {
    updateChoiceOptions(
      question.id,
      normalizeChoiceOptions(question).filter((option) => option.id !== optionId),
    );
  }

  function moveChoiceOption(question: FormQuestion, optionId: string, direction: -1 | 1) {
    const options = normalizeChoiceOptions(question);
    const fromIndex = options.findIndex((option) => option.id === optionId);
    const toIndex = fromIndex + direction;
    if (fromIndex === -1 || toIndex < 0 || toIndex >= options.length) return;
    const nextOptions = [...options];
    const [movedOption] = nextOptions.splice(fromIndex, 1);
    nextOptions.splice(toIndex, 0, movedOption);
    updateChoiceOptions(question.id, nextOptions);
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
    if (!selectedQuestion) return;
    const deleteIndex = selectedQuestionIndex;
    const remaining = draft.questions.filter((question) => question.id !== selectedQuestion.id);
    setDraft((current) => ({ ...current, questions: remaining }));
    const nextSelection = remaining[Math.min(deleteIndex, remaining.length - 1)] ?? remaining[deleteIndex - 1] ?? null;
    setSelectedQuestionId(nextSelection?.id ?? '');
    setFormsMessage('');
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

  function moveQuestion(questionId: string, direction: -1 | 1) {
    setDraft((current) => {
      const fromIndex = current.questions.findIndex((question) => question.id === questionId);
      const toIndex = fromIndex + direction;
      if (fromIndex === -1 || toIndex < 0 || toIndex >= current.questions.length) return current;
      const questions = [...current.questions];
      const [movedQuestion] = questions.splice(fromIndex, 1);
      questions.splice(toIndex, 0, movedQuestion);
      return { ...current, questions };
    });
    setSelectedQuestionId(questionId);
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
    const invalidChoiceQuestion = draft.questions.find((question) => validateChoiceOptions(question) !== '');
    if (invalidChoiceQuestion) {
      setSelectedQuestionId(invalidChoiceQuestion.id);
      setFormsMessage(validateChoiceOptions(invalidChoiceQuestion));
      return;
    }

    setIsSavingForm(true);
    setFormsMessage('');
    const questionIdBeforeSave = selectedQuestionId;
    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim(),
      questions: draft.questions.map(prepareQuestionForSave),
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
      setIsDeleteConfirmOpen(false);
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
        <section className="forms-page-header">
          <div>
            <h1>Forms</h1>
            <p>Create and manage questionnaires and reusable templates.</p>
          </div>
          <button className="btn btn-primary forms-page-button" type="button" onClick={openCreateModal}>
            {editorMode === 'forms' ? 'New form' : 'New template'}
          </button>
        </section>

        <section className="forms-page-tabs" aria-label="Forms views">
          <button
            className={`forms-page-tab${editorMode === 'forms' ? ' active' : ''}`}
            type="button"
            onClick={() => switchMode('forms')}
          >
            Forms
          </button>
          <button
            className={`forms-page-tab${editorMode === 'templates' ? ' active' : ''}`}
            type="button"
            onClick={() => switchMode('templates')}
          >
            Templates
          </button>
        </section>

        <section className="forms-editor-workspace">
          <aside className="card forms-editor-card forms-list-panel">
            <div className="forms-editor-card-head">
              <div>
                <h3>Your {editorMode === 'forms' ? 'forms' : 'templates'}</h3>
                <span>{activeItems.length} total</span>
              </div>
            </div>
            <div className="forms-library-search">
              <label className="sr-only" htmlFor="forms-library-search">
                Search {activeItemLabelLower}s
              </label>
              <input
                id="forms-library-search"
                className="form-control"
                placeholder={`Search ${activeItemLabelLower}s...`}
                value={activeSearch}
                onChange={(event) => {
                  if (editorMode === 'forms') setFormsSearch(event.target.value);
                  else setTemplatesSearch(event.target.value);
                }}
              />
            </div>
            <div className="forms-editor-list">
              {isLoadingActiveItems && (
                <div className="forms-editor-state">Loading {activeItemLabelLower}s...</div>
              )}
              {!isLoadingActiveItems && activeItems.length === 0 && (
                <div className="forms-editor-state">
                  No {activeItemLabelLower}s yet. Use {editorMode === 'forms' ? 'New form' : 'New template'} to create one.
                </div>
              )}
              {!isLoadingActiveItems && activeItems.length > 0 && filteredItems.length === 0 && (
                <div className="forms-editor-state">No {activeItemLabelLower}s match your search.</div>
              )}
              {filteredItems.map((form) => (
                <button
                  className={`forms-editor-form-item${selectedItemId === form.id ? ' active' : ''}`}
                  key={form.id}
                  type="button"
                  onClick={() => requestSelectItem(form)}
                >
                  <strong>{form.name}</strong>
                  <span>{form.questions.length} {form.questions.length === 1 ? 'question' : 'questions'}</span>
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
                      disabled={isCreatingItem}
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
                          disabled={isCreatingItem || (templates.length === 0 && !isLoadingTemplates)}
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
                          disabled={isCreatingItem || isLoadingTemplates || templates.length === 0}
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
                   <button className="btn btn-secondary" type="button" onClick={closeCreateModal} disabled={isCreatingItem}>
                     Cancel
                   </button>
                   <button className="btn btn-primary" type="button" onClick={confirmCreateItem} disabled={isCreatingItem}>
                    {isCreatingItem ? 'Creating...' : 'Create'}
                   </button>
                </div>
              </div>
            </div>
          )}

          {isDeleteConfirmOpen && (
            <div className="forms-editor-modal-backdrop" role="presentation">
              <div className="forms-editor-modal forms-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="forms-delete-title">
                <div className="forms-editor-modal-head">
                  <div>
                    <h3 id="forms-delete-title">Delete {draft.name}?</h3>
                    <p>This action will permanently delete this {activeItemLabelLower}.</p>
                  </div>
                  <button className="forms-editor-modal-close" type="button" onClick={() => setIsDeleteConfirmOpen(false)}>
                    ×
                  </button>
                </div>
                <div className="forms-editor-modal-actions">
                  <button className="btn btn-secondary" type="button" onClick={() => setIsDeleteConfirmOpen(false)} disabled={isSavingForm}>
                    Cancel
                  </button>
                  <button className="btn btn-secondary forms-danger-button" type="button" onClick={removeItem} disabled={isSavingForm}>
                    {isSavingForm ? 'Deleting...' : `Delete ${activeItemLabelLower}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {isPreviewOpen && (
            <QuestionnairePreview
              draft={draft}
              responses={previewResponses}
              onChange={setPreviewResponses}
              onClose={closePreview}
            />
          )}

          <section className="card forms-editor-card forms-editor-panel">
            <div className="forms-editor-header">
              <div>
                <h2>{draft.name || `Untitled ${activeItemLabelLower}`}</h2>
                <p>
                  {draft.questions.length} {draft.questions.length === 1 ? 'question' : 'questions'} · {activeItemLabel}
                </p>
              </div>
              <div className="forms-editor-header-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={openPreview}
                >
                  Preview
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
                  className="btn btn-primary"
                  type="button"
                  onClick={saveItem}
                  disabled={isSavingForm || !hasUnsavedChanges}
                >
                  {isSavingForm ? 'Saving...' : 'Save changes'}
                </button>
              </div>
              <div className="forms-editor-secondary-actions">
                <button
                  className="forms-editor-delete-link"
                  type="button"
                  onClick={() => setIsDeleteConfirmOpen(true)}
                  disabled={selectedItemId === null || isSavingForm}
                >
                  Delete {activeItemLabelLower}
                </button>
              </div>
            </div>
            <div className="forms-editor-form-title">
              <label className="form-field forms-editor-field" htmlFor="forms-item-name">
                <span className="form-label">Name</span>
                <input
                  id="forms-item-name"
                  className="form-control"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label className="form-field forms-editor-field" htmlFor="forms-item-description">
                <span className="form-label">Description (optional)</span>
                <textarea
                  id="forms-item-description"
                  className="form-control"
                  placeholder="Enter a short description..."
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>
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
              </div>
              {draft.questions.length === 0 && (
                <div className="forms-editor-state">This questionnaire has no questions yet.</div>
              )}
              {draft.questions.map((question, index) => (
                <Question
                  key={question.id}
                  active={selectedQuestionId === question.id}
                  title={question.text}
                  meta={`${question.type} · ${question.required ? 'Required' : 'Optional'}`}
                  canMoveUp={index > 0}
                  canMoveDown={index < draft.questions.length - 1}
                  onClick={() => setSelectedQuestionId(question.id)}
                  onMoveUp={() => moveQuestion(question.id, -1)}
                  onMoveDown={() => moveQuestion(question.id, 1)}
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
              </div>
            </div>
          </section>

          <aside className="card forms-editor-card forms-editor-settings-panel">
            <div className="forms-editor-card-head">
              <div>
                <h3>Question settings</h3>
                {selectedQuestion && (
                  <span>Question {selectedQuestionIndex + 1} of {draft.questions.length}</span>
                )}
              </div>
              {selectedQuestion && (
                <button className="forms-editor-delete-link" type="button" onClick={deleteQuestion}>
                  Delete question
                </button>
              )}
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
                      updateQuestionType(selectedQuestion.id, event.target.value)
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
                {isChoiceQuestion(selectedQuestion) && (
                  <div className="forms-answer-options" aria-describedby="forms-answer-options-help">
                    <div className="forms-answer-options-head">
                      <div>
                        <h4>Answer options</h4>
                        <p id="forms-answer-options-help">Add at least two options for respondents to choose from.</p>
                      </div>
                      <button className="forms-option-add" type="button" onClick={() => addChoiceOption(selectedQuestion)}>
                        + Add option
                      </button>
                    </div>
                    <div className="forms-option-list">
                      {selectedChoiceOptions.length === 0 && (
                        <div className="forms-option-empty">No answer options yet.</div>
                      )}
                      {selectedChoiceOptions.map((option, index) => (
                        <div className="forms-option-row" key={option.id}>
                          <span className="forms-option-drag" aria-hidden="true">⋮⋮</span>
                          <label className="sr-only" htmlFor={`forms-option-${option.id}`}>
                            Option {index + 1}
                          </label>
                          <input
                            id={`forms-option-${option.id}`}
                            className="form-control"
                            value={option.label}
                            placeholder={`Option ${index + 1}`}
                            onChange={(event) => updateChoiceOption(selectedQuestion, option.id, event.target.value)}
                          />
                          <div className="forms-option-actions" aria-label={`Reorder option ${index + 1}`}>
                            <button
                              type="button"
                              onClick={() => moveChoiceOption(selectedQuestion, option.id, -1)}
                              disabled={index === 0}
                              aria-label={`Move option ${index + 1} up`}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveChoiceOption(selectedQuestion, option.id, 1)}
                              disabled={index === selectedChoiceOptions.length - 1}
                              aria-label={`Move option ${index + 1} down`}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeChoiceOption(selectedQuestion, option.id)}
                              aria-label={`Remove option ${index + 1}`}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedChoiceOptionsError !== '' && (
                      <div className="forms-option-error" role="alert">{selectedChoiceOptionsError}</div>
                    )}
                  </div>
                )}
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
              <div className="forms-editor-state">Select a question to edit its settings.</div>
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
  active?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClick: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDragStart: () => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: () => void;
};

function Question({
  title,
  meta,
  active = false,
  canMoveUp,
  canMoveDown,
  onClick,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: QuestionProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card forms-editor-question${active ? ' active' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
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
      <div className="forms-editor-q-actions" aria-label="Question reorder controls">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onMoveUp();
          }}
          disabled={!canMoveUp}
          aria-label="Move question up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onMoveDown();
          }}
          disabled={!canMoveDown}
          aria-label="Move question down"
        >
          ↓
        </button>
      </div>
    </div>
  );
}

type QuestionnairePreviewProps = {
  draft: ReviewFormValues;
  responses: Record<string, PreviewResponse>;
  onChange: Dispatch<SetStateAction<Record<string, PreviewResponse>>>;
  onClose: () => void;
};

function QuestionnairePreview({ draft, responses, onChange, onClose }: QuestionnairePreviewProps) {
  const questionCountLabel = `${draft.questions.length} ${draft.questions.length === 1 ? 'question' : 'questions'}`;

  function updateResponse(questionId: string, value: PreviewResponse) {
    onChange((current) => ({ ...current, [questionId]: value }));
  }

  return (
    <div className="forms-preview-backdrop" role="presentation">
      <div className="forms-preview-modal" role="dialog" aria-modal="true" aria-labelledby="forms-preview-title">
        <div className="forms-preview-topbar">
          <div>
            <h3 id="forms-preview-title">Questionnaire preview</h3>
            <span className="forms-preview-mode">Preview mode</span>
          </div>
          <button className="forms-editor-modal-close" type="button" onClick={onClose} aria-label="Close preview">
            ×
          </button>
        </div>
        <div className="forms-preview-body">
          <div className="forms-preview-paper">
            <div className="forms-preview-heading">
              <span className="forms-preview-kicker">{questionCountLabel}</span>
              <h2>{draft.name || 'Untitled questionnaire'}</h2>
              {draft.description.trim() !== '' && <p>{draft.description}</p>}
            </div>

            {draft.questions.length === 0 ? (
              <div className="forms-preview-empty">This questionnaire has no questions yet.</div>
            ) : (
              <div className="forms-preview-questions">
                {draft.questions.map((question, index) => (
                  <PreviewQuestion
                    key={question.id}
                    question={question}
                    index={index}
                    value={responses[question.id]}
                    onChange={(value) => updateResponse(question.id, value)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="forms-preview-footer">
          <span>Responses are not saved.</span>
          <button className="btn btn-primary" type="button" onClick={onClose}>
            Close preview
          </button>
        </div>
      </div>
    </div>
  );
}

type PreviewQuestionProps = {
  question: FormQuestion;
  index: number;
  value: PreviewResponse | undefined;
  onChange: (value: PreviewResponse) => void;
};

function PreviewQuestion({ question, index, value, onChange }: PreviewQuestionProps) {
  const questionId = `forms-preview-${question.id}`;

  return (
    <div className="forms-preview-question">
      <div className="forms-preview-question-title">
        <span>{index + 1}.</span>
        <label htmlFor={questionId}>
          {question.text || 'Untitled question'} {question.required && <span aria-label="required">*</span>}
        </label>
      </div>
      {question.helpText.trim() !== '' && <p className="forms-preview-help">{question.helpText}</p>}
      <PreviewQuestionControl
        id={questionId}
        question={question}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

function PreviewQuestionControl({
  id,
  question,
  value,
  onChange,
}: {
  id: string;
  question: FormQuestion;
  value: PreviewResponse | undefined;
  onChange: (value: PreviewResponse) => void;
}) {
  if (question.type === 'Scale 1-5' || question.type === 'Scale 1-10') {
    const max = question.type === 'Scale 1-10' ? 10 : 5;
    return (
      <fieldset className="forms-preview-scale">
        <legend className="sr-only">{question.text}</legend>
        {Array.from({ length: max }, (_, index) => index + 1).map((rating) => (
          <label key={rating}>
            <input
              type="radio"
              name={id}
              value={rating}
              checked={value === rating}
              onChange={() => onChange(rating)}
            />
            <span>{rating}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.type === 'Single choice') {
    const options = getQuestionOptions(question);
    if (options.length === 0) return <div className="forms-preview-empty-control">No choices configured.</div>;
    return (
      <fieldset className="forms-preview-choice-group">
        <legend className="sr-only">{question.text}</legend>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.type === 'Multiple choice') {
    const options = getQuestionOptions(question);
    const selectedValues = Array.isArray(value) ? value : [];
    if (options.length === 0) return <div className="forms-preview-empty-control">No choices configured.</div>;
    return (
      <fieldset className="forms-preview-choice-group">
        <legend className="sr-only">{question.text}</legend>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              value={option.value}
              checked={selectedValues.includes(option.value)}
              onChange={(event) => {
                onChange(
                  event.target.checked
                    ? [...selectedValues, option.value]
                    : selectedValues.filter((selectedValue) => selectedValue !== option.value),
                );
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
    );
  }

  if (question.type === 'Number') {
    return (
      <input
        id={id}
        className="form-control forms-preview-control"
        type="number"
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'Date') {
    return (
      <input
        id={id}
        className="form-control forms-preview-control"
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (question.type === 'File upload') {
    return (
      <input
        id={id}
        className="form-control forms-preview-control"
        type="file"
        onChange={(event) => onChange(event.target.files?.[0]?.name ?? '')}
      />
    );
  }

  return (
    <textarea
      id={id}
      className="form-control forms-preview-control forms-preview-textarea"
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Type your response..."
    />
  );
}

function getQuestionOptions(question: FormQuestion) {
  const source = Array.isArray(question.options)
    ? question.options
    : Array.isArray(question.choices)
      ? question.choices
      : [];

  return source
    .map((option, index) => {
      if (typeof option === 'string') return { label: option, value: option };
      if (option && typeof option === 'object') {
        const label = 'label' in option && typeof option.label === 'string'
          ? option.label
          : 'text' in option && typeof option.text === 'string'
            ? option.text
            : `Option ${index + 1}`;
        const value = 'id' in option && typeof option.id === 'string'
          ? option.id
          : 'value' in option && typeof option.value === 'string'
            ? option.value
            : label;
        return { label, value };
      }
      return null;
    })
    .filter((option): option is { label: string; value: string } => option !== null);
}
