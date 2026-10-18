import { useEffect, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import AppLayout from '../layout/AppLayout';
import '../hr-home/hr-home.css';
import './forms.css';
import './questionnaire-choices.css';
import { createForm, createFormFromTemplate, createFormTemplate, fetchForms, fetchFormTemplates, updateForm, updateFormTemplate, type ChoiceOption, type FormBlock, type FormQuestion, type ReviewForm, type ReviewFormValues } from './forms.api';
import { fetchSections, saveSection as saveSectionRequest, setSectionArchived, type Section } from './sections.api';
import { moveFormItem, type DropPosition, type MovingItem } from './form-order';

type Mode = 'forms' | 'templates';
type Selected = { type: 'question'; id: string } | { type: 'section'; id: number } | null;
const makeQuestion = (): FormQuestion => ({ id: crypto.randomUUID(), text: 'New question', type: 'Text', required: true, helpText: '' });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const allQuestions = (blocks: FormBlock[]) => blocks.flatMap((block) => block.type === 'section' ? block.questions : [block.question]);
const choiceTypes = new Set(['Single choice', 'Multiple choice']);
const emptyOption = (): ChoiceOption => ({ id: crypto.randomUUID(), label: '' });
function optionsFor(question: FormQuestion): ChoiceOption[] {
  if (!Array.isArray(question.options)) return [];
  return question.options.map((option, index) => typeof option === 'string' ? { id: `legacy-${index}-${option}`, label: option } : option);
}
const initial = (name = 'Untitled form'): ReviewFormValues => ({ name, description: '', questions: [{ type: 'question', question: makeQuestion() }] });
const sectionQuestions = (blocks: FormBlock[], id: number) => blocks.find((block) => block.type === 'section' && block.section_id === id)?.type === 'section' ? (blocks.find((block) => block.type === 'section' && block.section_id === id) as Extract<FormBlock, { type: 'section' }>).questions : [];
function isScale(question: FormQuestion) { return ['Scale', 'Scale 1-5', 'Scale 1-10'].includes(question.type); }

export default function Forms() {
  const { getAccessTokenSilently } = useAuth0();
  const { state, retryAuth0 } = useAppAuth();
  const permissions = state.status === 'authenticated' && state.mode === 'auth0' ? state.user.permissions : [];
  const canManageForms = permissions.includes('forms.manage');
  const canManageSections = permissions.includes('sections.manage');
  function handleAccessError(error: unknown) {
    if (error instanceof ApiAccessError) retryAuth0();
  }
  const [mode, setMode] = useState<Mode>('forms');
  const [forms, setForms] = useState<ReviewForm[]>([]);
  const [templates, setTemplates] = useState<ReviewForm[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState('');
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSource, setCreateSource] = useState<'scratch' | 'template'>('scratch');
  const [createName, setCreateName] = useState('Untitled form');
  const [createTemplateId, setCreateTemplateId] = useState<number | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState('');
  const createRequestPending = useRef(false);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const editorNameInput = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [draft, setDraft] = useState<ReviewFormValues | null>(null);
  const [saved, setSaved] = useState<ReviewFormValues | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formsError, setFormsError] = useState('');
  const [formLoadAttempt, setFormLoadAttempt] = useState(0);
  const [selected, setSelected] = useState<Selected>(null);
  const [message, setMessage] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [sectionPending, setSectionPending] = useState(false);
  const [sectionMessage, setSectionMessage] = useState('');
  const [sectionError, setSectionError] = useState('');
  const sectionRequestPending = useRef(false);
  const [dragged, setDragged] = useState<MovingItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection: CollisionDetection = (args) => {
    const item = args.active.data.current?.item as MovingItem | undefined;
    const containers = args.droppableContainers.filter((container) => {
      const position = container.data.current?.position as DropPosition | undefined;
      return position && (item?.type === 'question' || position.type === 'top');
    });
    return pointerWithin({ ...args, droppableContainers: containers });
  };

  const currentItems = mode === 'forms' ? forms : templates;
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  const successMessage = message === 'Saved.' || message === 'Form created from template.';
  const selectedQuestion = selected?.type === 'question' && draft ? allQuestions(draft.questions).find((question) => question.id === selected.id) ?? null : null;
  const sectionNameFor = (id: number) => sections.find((section) => section.id === id)?.name ?? `Section ${id}`;
  const createTemplate = templates.find((item) => item.id === createTemplateId);

  useEffect(() => {
    if (!createOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !createRequestPending.current) { setCreateOpen(false); createTrigger.current?.focus(); }
      if (event.key === 'Tab') {
        const dialog = document.getElementById('forms-create-dialog');
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [createOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetchForms(getAccessTokenSilently, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setForms((current) => [...current.filter((item) => !data.some((loaded) => loaded.id === item.id)), ...data]); setFormsError(''); }
    }).catch((error: unknown) => {
      handleAccessError(error);
      if (!controller.signal.aborted) setFormsError(error instanceof Error ? error.message : 'Forms could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setFormsLoading(false); });
    return () => controller.abort();
  }, [formLoadAttempt, getAccessTokenSilently]);
  useEffect(() => {
    const controller = new AbortController();
    fetchFormTemplates(getAccessTokenSilently, controller.signal).then((items) => {
      if (!controller.signal.aborted) { setTemplates((current) => [...current.filter((item) => !items.some((loaded) => loaded.id === item.id)), ...items]); setTemplatesError(''); }
    }).catch((error: unknown) => {
      handleAccessError(error);
      if (!controller.signal.aborted) setTemplatesError(error instanceof Error ? error.message : 'Templates could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setTemplatesLoading(false); });
    return () => controller.abort();
  }, [templateLoadAttempt, getAccessTokenSilently]);
  useEffect(() => {
    const controller = new AbortController();
    fetchSections(getAccessTokenSilently, controller.signal).then((items) => {
      // Keep confirmed mutations if the initial catalog request finishes later.
      if (!controller.signal.aborted) setSections((current) => [...items.filter((item) => !current.some((section) => section.id === item.id)), ...current].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch((error: unknown) => {
      handleAccessError(error);
      if (!controller.signal.aborted) setSectionError(error instanceof Error ? error.message : 'Sections could not be loaded.');
    });
    return () => controller.abort();
  }, [getAccessTokenSilently]);

  function choose(item: ReviewForm) { const next = { name: item.name, description: item.description, questions: copy(item.questions) }; setSelectedId(item.id); setDraft(next); setSaved(copy(next)); setSelected(null); setPreviewOpen(false); setMessage(''); }
  function selectItem(item: ReviewForm) {
    if (dirty && !window.confirm('Discard unsaved changes before selecting another item?')) return;
    choose(item);
  }
  function openCreate() {
    if (!canManageForms) return;
    if (dirty && !window.confirm('Discard unsaved changes before creating a new form?')) return;
    setCreateName('Untitled form'); setCreateSource('scratch'); setCreateTemplateId(null); setCreateError(''); setCreateOpen(true);
  }
  function startTemplate() {
    if (!canManageForms) return;
    if (dirty && !window.confirm('Discard unsaved changes before creating a new template?')) return;
    const next = initial('Untitled template');
    setSelectedId(null); setDraft(next); setSaved(copy(next)); setSelected(null); setPreviewOpen(false); setMessage('');
  }
  function closeCreate() { if (createRequestPending.current) return; setCreateOpen(false); createTrigger.current?.focus(); }
  async function confirmCreate() {
    if (!canManageForms || createRequestPending.current || !createName.trim() || (createSource === 'template' && !createTemplate)) return;
    createRequestPending.current = true;
    setCreatePending(true); setCreateError('');
    try {
      const item = createSource === 'template' && createTemplate
        ? await createFormFromTemplate(getAccessTokenSilently, createName.trim(), createTemplate.description, createTemplate.id)
        : await createForm(getAccessTokenSilently, { ...initial(createName.trim()), questions: [] });
      setForms((items) => [item, ...items.filter((form) => form.id !== item.id)]);
      setMode('forms'); choose(item); setMessage(''); setCreateTemplateId(null); setCreateOpen(false);
      requestAnimationFrame(() => editorNameInput.current?.focus());
    } catch (error) { handleAccessError(error); setCreateError(`${error instanceof Error ? error.message : 'Form creation could not be confirmed.'} Check Your forms before retrying if the request timed out.`); }
    finally { createRequestPending.current = false; setCreatePending(false); }
  }
  function changeMode(nextMode: Mode) {
    if (nextMode === mode || (dirty && !window.confirm('Discard unsaved changes before switching tabs?'))) return;
    setMode(nextMode); setMessage(''); setSelectedId(null); setDraft(null); setSaved(null); setSelected(null); setPreviewOpen(false); setDragged(null);
  }
  function updateQuestion(id: string, patch: Partial<FormQuestion>) {
    setDraft((state) => state && ({ ...state, questions: state.questions.map((block) => block.type === 'question' ? block.question.id === id ? { ...block, question: { ...block.question, ...patch } } : block : { ...block, questions: block.questions.map((question) => question.id === id ? { ...question, ...patch } : question) }) }));
  }
  function appendQuestion(sectionId?: number) {
    const question = makeQuestion();
    setDraft((state) => state && ({ ...state, questions: sectionId === undefined ? [...state.questions, { type: 'question', question }] : state.questions.map((block) => block.type === 'section' && block.section_id === sectionId ? { ...block, questions: [...block.questions, question] } : block) }));
    setSelected({ type: 'question', id: question.id });
  }
  function appendSection(id: number) { setDraft((state) => state && ({ ...state, questions: [...state.questions, { type: 'section', section_id: id, questions: [] }] })); setSelected({ type: 'section', id }); }
  function removeSection(id: number) {
    if (!window.confirm('Remove this section from the form? Its questions will become standalone.')) return;
    setDraft((state) => {
      if (!state) return null;
      const blocks: FormBlock[] = [];
      for (const block of state.questions) {
        if (block.type === 'section' && block.section_id === id) blocks.push(...block.questions.map((question) => ({ type: 'question' as const, question })));
        else blocks.push(block);
      }
      return { ...state, questions: blocks };
    });
    setSelected(null);
  }
  function deleteQuestion(id: string) { setDraft((state) => state && ({ ...state, questions: state.questions.reduce<FormBlock[]>((blocks, block) => { if (block.type === 'question') { if (block.question.id !== id) blocks.push(block); } else blocks.push({ ...block, questions: block.questions.filter((question) => question.id !== id) }); return blocks; }, []) })); setSelected(null); }
  function moveItem(item: MovingItem, position: DropPosition) { setDraft((state) => state && ({ ...state, questions: moveFormItem(state.questions, item, position) })); }
  function moveQuestion(id: string, targetSection: number | null) {
    if (!draft) return;
    const section = draft.questions.find((block) => block.type === 'section' && block.section_id === targetSection);
    moveItem({ type: 'question', id }, targetSection === null ? { type: 'top', index: draft.questions.length } : { type: 'section', id: targetSection, index: section?.type === 'section' ? section.questions.length : 0 });
  }
  function endDrag(event: DragEndEvent) {
    setDragged(null);
    const item = event.active.data.current?.item as MovingItem | undefined;
    const position = event.over?.data.current?.position as DropPosition | undefined;
    if (item && position) moveItem(item, position);
  }
  async function save() {
    if (!draft || !canManageForms) return;
    if (!draft.name.trim()) { setMessage('Name is required.'); return; }
    try {
      const payload = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
      const savedItem = mode === 'forms' ? selectedId === null ? await createForm(getAccessTokenSilently, payload) : await updateForm(getAccessTokenSilently, selectedId, payload) : selectedId === null ? await createFormTemplate(getAccessTokenSilently, payload) : await updateFormTemplate(getAccessTokenSilently, selectedId, payload);
      const setItems = mode === 'forms' ? setForms : setTemplates;
      setItems((items) => items.some((item) => item.id === savedItem.id) ? items.map((item) => item.id === savedItem.id ? savedItem : item) : [savedItem, ...items]);
      choose(savedItem); setMessage('Saved.');
    } catch (error) { handleAccessError(error); setMessage(error instanceof Error ? error.message : 'Save failed.'); }
  }
  async function saveSection() {
    if (!canManageSections || !sectionName.trim() || sectionRequestPending.current) return;
    sectionRequestPending.current = true;
    setSectionPending(true); setSectionError(''); setSectionMessage('');
    try {
      const item = await saveSectionRequest(getAccessTokenSilently, editingSection?.id ?? null, sectionName);
      setSections((items) => [...items.filter((section) => section.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
      setSectionName(''); setEditingSection(null);
      setSectionMessage(editingSection ? 'Section renamed.' : 'Section created.');
    } catch (error) { handleAccessError(error); setSectionError(error instanceof Error ? error.message : 'Section save failed.'); }
    finally { sectionRequestPending.current = false; setSectionPending(false); }
  }
  async function archiveSection(item: Section) {
    if (!canManageSections || sectionRequestPending.current) return;
    sectionRequestPending.current = true;
    setSectionPending(true); setSectionError(''); setSectionMessage('');
    try {
      const updated = await setSectionArchived(getAccessTokenSilently, item.id, !item.is_archived);
      setSections((items) => items.map((section) => section.id === updated.id ? updated : section));
      setEditingSection((current) => current?.id === updated.id ? updated : current);
      setSectionMessage(updated.is_archived ? 'Section archived.' : 'Section restored.');
    } catch (error) { handleAccessError(error); setSectionError(error instanceof Error ? error.message : 'Section update failed.'); }
    finally { sectionRequestPending.current = false; setSectionPending(false); }
  }
  return <AppLayout activePage="forms" pageClassName="forms-page"><div className="main-content forms-editor-main">
    <section className="forms-page-header"><div><h1>Forms</h1><p>Create questionnaires with reusable analytical sections.</p></div><div className="forms-editor-header-actions"><button className="btn btn-secondary" onClick={() => setManageOpen(true)}>Manage sections</button>{canManageForms && <button className="btn btn-primary" ref={mode === 'forms' ? createTrigger : undefined} onClick={mode === 'forms' ? openCreate : startTemplate}>New {mode === 'forms' ? 'form' : 'template'}</button>}</div></section>
    <section className="forms-page-tabs"><button className={mode === 'forms' ? 'forms-page-tab active' : 'forms-page-tab'} onClick={() => changeMode('forms')}>Forms</button><button className={mode === 'templates' ? 'forms-page-tab active' : 'forms-page-tab'} onClick={() => changeMode('templates')}>Templates</button></section>
    <section className="forms-editor-workspace"><aside className="card forms-editor-card forms-list-panel"><div className="forms-editor-card-head"><div><h3>Your {mode}</h3><span>{currentItems.length} total</span></div></div>
      {mode === 'forms' && formsError && <div className="forms-editor-state"><p className="forms-option-error" role="alert">{formsError}</p><button className="btn btn-secondary" disabled={formsLoading} onClick={() => { setFormsError(''); setFormsLoading(true); setFormLoadAttempt((attempt) => attempt + 1); }}>Retry loading forms</button></div>}
      {mode === 'forms' && formsLoading && <div className="forms-editor-state" role="status">Loading forms...</div>}
      {mode === 'forms' && !formsLoading && !formsError && forms.length === 0 && <div className="forms-editor-state">No forms yet. Create a form to start building your questionnaire.</div>}
      {mode === 'templates' && templatesError && <div className="forms-editor-state"><p className="forms-option-error" role="alert">{templatesError}</p><button className="btn btn-secondary" disabled={templatesLoading} onClick={() => { setTemplatesError(''); setTemplatesLoading(true); setTemplateLoadAttempt((attempt) => attempt + 1); }}>Retry loading templates</button></div>}
      {mode === 'templates' && templatesLoading && <div className="forms-editor-state" role="status">Loading templates...</div>}
      {mode === 'templates' && !templatesLoading && !templatesError && templates.length === 0 && <div className="forms-editor-state">No templates yet. Create a template to reuse a questionnaire.</div>}
      <div className="forms-editor-list">{currentItems.map((item) => <button key={item.id} className={`forms-editor-form-item${item.id === selectedId ? ' active' : ''}`} onClick={() => selectItem(item)}><strong>{item.name}</strong><span>{allQuestions(item.questions).length} questions</span></button>)}</div></aside>
      <section className="card forms-editor-card forms-editor-panel">{draft && !canManageForms ? <div className="forms-editor-empty"><h2>{draft.name}</h2><p>{allQuestions(draft.questions).length} questions · Read-only access</p><button className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>Preview questionnaire</button></div> : draft ? <><div className="forms-editor-header"><div className="forms-editor-header-title"><h2>{draft.name}</h2><p>{allQuestions(draft.questions).length} questions</p></div><div className="forms-editor-header-actions"><button className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>Preview</button><button className="btn btn-secondary" disabled={!dirty} onClick={() => { if (saved) setDraft(copy(saved)); setSelected(null); }}>Discard</button><button className="btn btn-primary" disabled={!dirty} onClick={save}>Save changes</button></div></div>
        <label className="form-field forms-editor-field"><span className="form-label">Name</span><input className="form-control" aria-label="Name" ref={editorNameInput} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="form-field forms-editor-field"><span className="form-label">Description</span><textarea className="form-control" aria-label="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>{message && <p className={`forms-editor-message${successMessage ? ' success' : ''}`} role={successMessage ? 'status' : 'alert'}>{message}</p>}
         <div className="forms-editor-section"><div className="forms-editor-section-head"><h3>Questionnaire structure</h3><div><button className="btn btn-secondary" onClick={() => appendQuestion()}>Add question</button><select className="form-control" defaultValue="" onChange={(event) => { if (event.target.value) { appendSection(Number(event.target.value)); event.target.value = ''; } }}><option value="">Add section</option>{sections.filter((section) => !section.is_archived && !draft.questions.some((block) => block.type === 'section' && block.section_id === section.id)).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></div></div>
           <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={(event: DragStartEvent) => setDragged(event.active.data.current?.item as MovingItem)} onDragEnd={endDrag} onDragCancel={() => setDragged(null)}>
             <div className="forms-structure-list">
               {draft.questions.map((block, index) => <div key={block.type === 'section' ? `section-${block.section_id}` : `question-${block.question.id}`}>
                 <DropSlot position={{ type: 'top', index }} dragging={dragged} />
                 {block.type === 'section' ? <SectionBlock block={block} name={sectionNameFor(block.section_id)} selected={selected} onSelect={setSelected} onAdd={() => appendQuestion(block.section_id)} onRemove={() => removeSection(block.section_id)} onDeleteQuestion={deleteQuestion} dragging={dragged} onMove={moveItem} topIndex={index} topCount={draft.questions.length} /> : <QuestionCard question={block.question} active={selected?.type === 'question' && selected.id === block.question.id} onSelect={() => setSelected({ type: 'question', id: block.question.id })} onDelete={() => deleteQuestion(block.question.id)} onMove={moveItem} position={{ type: 'top', index }} count={draft.questions.length} />}
               </div>)}
               <DropSlot position={{ type: 'top', index: draft.questions.length }} dragging={dragged} />
             </div>
             <DragOverlay dropAnimation={null}>{dragged && <div className="forms-drag-preview">{dragged.type === 'section' ? sectionNameFor(dragged.id) : allQuestions(draft.questions).find((question) => question.id === dragged.id)?.text ?? 'Question'}</div>}</DragOverlay>
           </DndContext>
            </div></> : <div className="forms-editor-empty">
              {(mode === 'forms' ? formsLoading : templatesLoading) ? <p role="status">Loading {mode}...</p>
                : (mode === 'forms' ? formsError : templatesError) ? <p role="alert">{mode === 'forms' ? formsError : templatesError}</p>
                  : <>
                    <h2>{currentItems.length === 0 ? `No ${mode} yet` : mode === 'forms' ? 'No form selected' : 'No template selected'}</h2>
                    <p>{currentItems.length === 0 ? mode === 'forms' ? 'No questionnaires are available.' : 'No templates are available.' : `Select an existing ${mode === 'forms' ? 'form' : 'template'} from the list${canManageForms ? ', or create a new one.' : '.'}`}</p>
                    {canManageForms && <button className="btn btn-primary" type="button" onClick={mode === 'forms' ? openCreate : startTemplate}>New {mode === 'forms' ? 'form' : 'template'}</button>}
                  </>}
            </div>}</section>
        <aside className="card forms-editor-card forms-editor-settings-panel"><div className="forms-editor-card-head"><h3>{draft && selected?.type === 'section' ? 'Section settings' : 'Question settings'}</h3></div>{!canManageForms ? <div className="forms-editor-state">Read-only access. Use Preview to view the questionnaire.</div> : !draft ? <div className="forms-editor-state">Settings will appear when a form or template is open.</div> : selected?.type === 'section' ? <div className="forms-editor-props"><h3>{sectionNameFor(selected.id)}</h3><p>{sectionQuestions(draft.questions, selected.id).length} questions</p><button className="btn btn-secondary" onClick={() => appendQuestion(selected.id)}>Add question</button><button className="forms-editor-delete-link" onClick={() => removeSection(selected.id)}>Remove section from form</button></div> : selectedQuestion ? <QuestionEditor question={selectedQuestion} sections={sections} current={draft.questions.find((block) => block.type === 'section' && block.questions.some((question) => question.id === selectedQuestion.id))?.type === 'section' ? (draft.questions.find((block) => block.type === 'section' && block.questions.some((question) => question.id === selectedQuestion.id)) as Extract<FormBlock, { type: 'section' }>).section_id : null} onUpdate={(patch) => updateQuestion(selectedQuestion.id, patch)} onMove={(id) => moveQuestion(selectedQuestion.id, id)} onDelete={() => deleteQuestion(selectedQuestion.id)} /> : <div className="forms-editor-state">Select a question or section to edit it.</div>}</aside></section>
    {createOpen && <div className="forms-editor-modal-backdrop" role="presentation"><div className="forms-editor-modal forms-create-modal" id="forms-create-dialog" role="dialog" aria-modal="true" aria-labelledby="forms-create-title" aria-describedby="forms-create-subtitle">
      <div className="forms-editor-modal-head"><div><h3 id="forms-create-title">Create form</h3><p id="forms-create-subtitle">Choose how to start your questionnaire.</p></div><button className="forms-editor-modal-close" type="button" aria-label="Close" disabled={createPending} onClick={closeCreate}>×</button></div>
      <div className="forms-editor-modal-body"><label className="form-field forms-editor-field"><span className="form-label">Form name</span><input className="form-control" aria-label="Form name" autoFocus value={createName} disabled={createPending} onChange={(event) => { setCreateName(event.target.value); setCreateError(''); }} /></label>
        <button type="button" className={`forms-create-option${createSource === 'scratch' ? ' active' : ''}`} aria-pressed={createSource === 'scratch'} disabled={createPending} onClick={() => { setCreateSource('scratch'); setCreateError(''); }}><strong>Start from scratch</strong><span>Create an empty questionnaire and add your own sections and questions.</span></button>
        <button type="button" className={`forms-create-option${createSource === 'template' ? ' active' : ''}`} aria-pressed={createSource === 'template'} disabled={createPending} onClick={() => { setCreateSource('template'); setCreateError(''); }}><strong>Start from a template</strong><span>Choose an existing questionnaire template.</span></button>
        {createSource === 'template' && <div className="forms-create-templates">
          {templatesLoading ? <p role="status">Loading templates...</p> : templatesError ? <><p className="forms-option-error" role="alert">{templatesError}</p><button className="btn btn-secondary" type="button" disabled={createPending} onClick={() => { setTemplatesError(''); setTemplatesLoading(true); setTemplateLoadAttempt((attempt) => attempt + 1); }}>Retry loading templates</button></> : templates.length === 0 ? <p>No templates available yet.</p> : templates.map((item) => <button key={item.id} type="button" className={`forms-create-template${item.id === createTemplateId ? ' active' : ''}`} aria-pressed={item.id === createTemplateId} disabled={createPending} onClick={() => { setCreateTemplateId(item.id); setCreateName(`${item.name} copy`); setCreateError(''); }}><strong>{item.name}</strong><span>{allQuestions(item.questions).length} {allQuestions(item.questions).length === 1 ? 'question' : 'questions'}</span>{item.description && <small>{item.description}</small>}</button>)}
        </div>}
        {createError && <p className="forms-option-error" role="alert">{createError}</p>}
      </div>
      <div className="forms-editor-modal-actions"><button className="btn btn-secondary" type="button" disabled={createPending} onClick={closeCreate}>Cancel</button><button className="btn btn-primary" type="button" disabled={createPending || !createName.trim() || (createSource === 'template' && (!createTemplate || !!templatesError || templatesLoading))} onClick={confirmCreate}>{createPending ? 'Creating...' : 'Create form'}</button></div>
    </div></div>}
    {manageOpen && <ManageSections sections={sections} name={sectionName} editing={editingSection} pending={sectionPending} message={sectionMessage} error={sectionError} canManage={canManageSections} onName={setSectionName} onEdit={(item) => { setEditingSection(item); setSectionName(item?.name ?? ''); setSectionMessage(''); setSectionError(''); }} onSave={saveSection} onArchive={archiveSection} onClose={() => setManageOpen(false)} />}
    {previewOpen && draft && <Preview draft={draft} name={sectionNameFor} onClose={() => setPreviewOpen(false)} />}
  </div></AppLayout>;
}

function DropSlot({ position, dragging }: { position: DropPosition; dragging: MovingItem | null }) {
  const { setNodeRef, isOver } = useDroppable({ id: position.type === 'top' ? `slot:top:${position.index}` : `slot:section:${position.id}:${position.index}`, data: { position }, disabled: dragging?.type === 'section' && position.type === 'section' });
  return <div ref={setNodeRef} aria-hidden="true" className={`forms-drop-slot${dragging ? ' dragging' : ''}${isOver ? ' over' : ''}`} />;
}
function DragHandle({ item, label }: { item: MovingItem; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.type === 'section' ? `drag:section:${item.id}` : `drag:question:${item.id}`, data: { item } });
  return <button type="button" ref={setNodeRef} className={`forms-drag-handle${isDragging ? ' dragging' : ''}`} aria-label={`Drag ${label}`} title={`Drag ${label}`} {...attributes} {...listeners} onClick={(event) => event.stopPropagation()}><GripVertical size={16} aria-hidden="true" /></button>;
}
function MoveControls({ item, position, count, onMove }: { item: MovingItem; position: DropPosition; count: number; onMove: (item: MovingItem, position: DropPosition) => void }) {
  const destination = (index: number): DropPosition => position.type === 'top' ? { type: 'top', index } : { type: 'section', id: position.id, index };
  return <div className="forms-move-controls"><button type="button" aria-label={`Move ${item.type} up`} title="Move up" disabled={position.index === 0} onClick={(event) => { event.stopPropagation(); onMove(item, destination(position.index - 1)); }}>↑</button><button type="button" aria-label={`Move ${item.type} down`} title="Move down" disabled={position.index === count - 1} onClick={(event) => { event.stopPropagation(); onMove(item, destination(position.index + 2)); }}>↓</button></div>;
}
function QuestionCard({ question, active, onSelect, onDelete, onMove, position, count }: { question: FormQuestion; active: boolean; onSelect: () => void; onDelete: () => void; onMove: (item: MovingItem, position: DropPosition) => void; position: DropPosition; count: number }) {
  const range = isScale(question) ? ` · ${question.scale_min ?? 1}-${question.scale_max ?? (question.type === 'Scale 1-10' ? 10 : 5)}` : '';
  return <div className={`card forms-editor-question${active ? ' active' : ''}`} onClick={onSelect}>
    <DragHandle item={{ type: 'question', id: question.id }} label="question" />
    <button type="button" className="forms-editor-q-main" aria-pressed={active} onClick={(event) => { event.stopPropagation(); onSelect(); }}>
      <strong title={question.text}>{question.text || 'Untitled question'}</strong>
      <span>{isScale(question) ? 'Scale' : question.type}{range} · {question.required ? 'Required' : 'Optional'}</span>
    </button>
    <div className="forms-card-actions"><MoveControls item={{ type: 'question', id: question.id }} position={position} count={count} onMove={onMove} /><button type="button" className="forms-editor-delete-link" onClick={(event) => { event.stopPropagation(); onDelete(); }}>Remove</button></div>
  </div>;
}
function SectionBlock({ block, name, selected, onSelect, onAdd, onRemove, onDeleteQuestion, onMove, dragging, topIndex, topCount }: { block: Extract<FormBlock, { type: 'section' }>; name: string; selected: Selected; onSelect: (selected: Selected) => void; onAdd: () => void; onRemove: () => void; onDeleteQuestion: (id: string) => void; onMove: (item: MovingItem, position: DropPosition) => void; dragging: MovingItem | null; topIndex: number; topCount: number }) {
  const active = selected?.type === 'section' && selected.id === block.section_id;
  return <div className={`forms-section-block${active ? ' active' : ''}`}>
    <div className="forms-section-heading">
      <DragHandle item={{ type: 'section', id: block.section_id }} label="section" />
      <button type="button" className="forms-editor-q-main" aria-pressed={active} onClick={() => onSelect({ type: 'section', id: block.section_id })}>
        <strong title={name}>{name}</strong><span>{block.questions.length} {block.questions.length === 1 ? 'question' : 'questions'}</span>
      </button>
      <div className="forms-card-actions"><MoveControls item={{ type: 'section', id: block.section_id }} position={{ type: 'top', index: topIndex }} count={topCount} onMove={onMove} /><button type="button" className="forms-editor-delete-link" onClick={onRemove}>Remove section</button></div>
    </div>
    {block.questions.map((question, index) => <div key={question.id}><DropSlot position={{ type: 'section', id: block.section_id, index }} dragging={dragging} /><QuestionCard question={question} active={selected?.type === 'question' && selected.id === question.id} onSelect={() => onSelect({ type: 'question', id: question.id })} onDelete={() => onDeleteQuestion(question.id)} onMove={onMove} position={{ type: 'section', id: block.section_id, index }} count={block.questions.length} /></div>)}
    <DropSlot position={{ type: 'section', id: block.section_id, index: block.questions.length }} dragging={dragging} />
    <button type="button" className="forms-add-in-section" onClick={onAdd}>Add question to {name}</button>
  </div>;
}
function QuestionEditor({ question, sections, current, onUpdate, onMove, onDelete }: { question: FormQuestion; sections: Section[]; current: number | null; onUpdate: (patch: Partial<FormQuestion>) => void; onMove: (id: number | null) => void; onDelete: () => void }) {
  const options = optionsFor(question);
  function updateOptions(next: ChoiceOption[]) { onUpdate({ options: next }); }
  function moveOption(index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= options.length) return; const next = [...options]; const [option] = next.splice(index, 1); next.splice(target, 0, option); updateOptions(next); }
  return <div className="forms-editor-props">
    <button className="forms-editor-delete-link" onClick={onDelete}>Delete question</button>
    <label className="form-field forms-editor-field"><span className="form-label">Question text</span><textarea className="form-control" aria-label="Question text" value={question.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label>
    <label className="form-field forms-editor-field"><span className="form-label">Question type</span><select className="form-control" aria-label="Question type" value={question.type} onChange={(event) => { const type = event.target.value; onUpdate({ type, options: choiceTypes.has(type) ? question.options ?? [] : undefined, ...(isScale({ ...question, type }) ? { scale_min: question.scale_min ?? 1, scale_max: question.scale_max ?? 5, scale_direction: 'higher_is_better' } : {}) }); }}>
      {!['Scale', 'Text', 'Single choice', 'Multiple choice'].includes(question.type) && <option value={question.type}>{question.type}</option>}
      <option value="Scale">Numerical scale</option><option>Text</option><option>Single choice</option><option>Multiple choice</option>
    </select></label>
    <label className="form-field forms-editor-field"><span className="form-label">Placement</span><select className="form-control" aria-label="Placement" value={current ?? ''} onChange={(event) => onMove(event.target.value === '' ? null : Number(event.target.value))}><option value="">Standalone / No section</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.name}{section.is_archived ? ' (archived)' : ''}</option>)}</select></label>
    {choiceTypes.has(question.type) && <div className="forms-answer-options">
      <div className="forms-answer-options-head"><h4>Answer options</h4><button className="forms-option-add" onClick={() => updateOptions([...options, emptyOption()])}>Add option</button></div>
      {options.map((option, index) => <div className="forms-option-row" key={option.id}>
        <input className="form-control" aria-label={`Option ${index + 1}`} value={option.label} placeholder={`Option ${index + 1}`} onChange={(event) => updateOptions(options.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item))} />
        <div className="forms-option-actions"><button aria-label={`Move option ${index + 1} up`} onClick={() => moveOption(index, -1)} disabled={index === 0}>↑</button><button aria-label={`Move option ${index + 1} down`} onClick={() => moveOption(index, 1)} disabled={index === options.length - 1}>↓</button><button aria-label={`Remove option ${index + 1}`} onClick={() => updateOptions(options.filter((item) => item.id !== option.id))}>Remove</button></div>
      </div>)}
    </div>}
    {isScale(question) && <>
      <p className="forms-editor-hint">Higher values always mean better performance.</p>
      <label className="form-field forms-editor-field"><span className="form-label">Minimum</span><input className="form-control" type="number" value={question.scale_min ?? 1} onChange={(event) => onUpdate({ scale_min: Number(event.target.value), scale_direction: 'higher_is_better' })} /></label>
      <label className="form-field forms-editor-field"><span className="form-label">Maximum</span><input className="form-control" type="number" value={question.scale_max ?? 5} onChange={(event) => onUpdate({ scale_max: Number(event.target.value), scale_direction: 'higher_is_better' })} /></label>
      <label className="form-field forms-editor-field"><span className="form-label">Lowest rating label</span><input className="form-control" value={question.min_label ?? ''} onChange={(event) => onUpdate({ min_label: event.target.value })} /></label>
      <label className="form-field forms-editor-field"><span className="form-label">Highest rating label</span><input className="form-control" value={question.max_label ?? ''} onChange={(event) => onUpdate({ max_label: event.target.value })} /></label>
    </>}
    <label className="forms-editor-switch"><span>Required question</span><input type="checkbox" checked={question.required} onChange={(event) => onUpdate({ required: event.target.checked })} /></label>
  </div>;
}
function ManageSections({ sections, name, editing, pending, message, error, canManage, onName, onEdit, onSave, onArchive, onClose }: { sections: Section[]; name: string; editing: Section | null; pending: boolean; message: string; error: string; canManage: boolean; onName: (name: string) => void; onEdit: (section: Section | null) => void; onSave: () => void; onArchive: (section: Section) => void; onClose: () => void }) {
  return <div className="forms-editor-modal-backdrop"><div className="forms-dimension-modal card" role="dialog" aria-modal="true" aria-label="Manage sections">
    <div className="forms-editor-card-head"><h3>Manage sections</h3><button className="forms-editor-delete-link" disabled={pending} onClick={onClose}>Close</button></div>
    {error && <p className="forms-option-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="forms-dimension-modal-grid"><div className="forms-dimension-list">
      {sections.map((section) => <div className={`forms-dimension-item${editing?.id === section.id ? ' active' : ''}`} key={section.id}>
        <strong>{section.name}</strong><span>{section.is_archived ? 'Archived' : 'Active'}</span>
        <div><button className="btn btn-secondary" disabled={pending || !canManage} onClick={() => onEdit(section)}>Rename</button><button className="btn btn-secondary" disabled={pending || !canManage} onClick={() => onArchive(section)}>{section.is_archived ? 'Restore' : 'Archive'}</button></div>
      </div>)}
    </div><div className="forms-dimension-editor">
      <input className="form-control" aria-label="Section name" value={name} disabled={pending} placeholder="Section name" onChange={(event) => onName(event.target.value)} />
      <button className="btn btn-primary" disabled={pending || !canManage || !name.trim()} onClick={onSave}>{pending ? 'Saving...' : editing ? 'Rename' : 'Create section'}</button>
      <button className="btn btn-secondary" disabled={pending} onClick={() => onEdit(null)}>New</button>
    </div></div>
  </div></div>;
}
function Preview({ draft, name, onClose }: { draft: ReviewFormValues; name: (id: number) => string; onClose: () => void }) { return <div className="forms-preview-backdrop"><div className="forms-preview-modal"><div className="forms-preview-topbar"><div><h3>Questionnaire preview</h3><span className="forms-preview-mode">Preview mode</span></div><button className="forms-editor-modal-close" onClick={onClose}>×</button></div><div className="forms-preview-body"><div className="forms-preview-paper"><h2>{draft.name}</h2>{draft.questions.map((block, blockIndex) => <div key={blockIndex}>{block.type === 'section' && <h3 className="forms-preview-section-title">{name(block.section_id)}</h3>}{(block.type === 'section' ? block.questions : [block.question]).map((question, questionIndex) => { const index = draft.questions.slice(0, blockIndex).reduce((count, previous) => count + (previous.type === 'section' ? previous.questions.length : 1), questionIndex + 1); const min = question.scale_min ?? 1; const max = question.scale_max ?? 5; return <div className="forms-preview-question" key={question.id}><strong>{index}. {question.text} {question.required && '*'}</strong>{isScale(question) ? <div className="forms-preview-scale-group"><div className="forms-preview-scale">{Array.from({ length: max - min + 1 }, (_, value) => <label key={value}><input type="radio" name={question.id} />{min + value}</label>)}</div><div className="forms-preview-endpoints"><span>{question.min_label || 'Lowest rating'}</span><span>{question.max_label || 'Highest rating'}</span></div></div> : choiceTypes.has(question.type) ? <div className="forms-preview-choice-group">{optionsFor(question).map((option) => <label key={option.id}><input type={question.type === 'Single choice' ? 'radio' : 'checkbox'} name={question.id} /> {option.label}</label>)}</div> : <textarea className="form-control" placeholder="Preview response" />}</div>; })}</div>)}</div></div><div className="forms-preview-footer"><span>Responses are not saved.</span><button className="btn btn-primary" onClick={onClose}>Close preview</button></div></div></div>; }
