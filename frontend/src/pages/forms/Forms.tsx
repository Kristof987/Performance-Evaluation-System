import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { Archive, ArrowLeft, ChevronDown, ChevronRight, FilePlus2, FileSpreadsheet, FileText, GripVertical, Layers3, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError } from '../../auth/authenticated-api';
import AppLayout from '../layout/AppLayout';
import { useConfirm, useToast } from '../../components/feedback/feedback-context';
import InlineMessage from '../../components/feedback/InlineMessage';
import '../hr-home/hr-home.css';
import './forms.css';
import './questionnaire-choices.css';
import { createForm, createFormFromTemplate, createFormTemplate, deleteForm, deleteFormTemplate, fetchForms, fetchFormTemplates, restoreForm, updateForm, updateFormTemplate, type AIGeneratedForm, type ExcelFormDraft, type AIGeneratedQuestion, type ChoiceOption, type FormBlock, type FormQuestion, type ReviewForm, type ReviewFormValues } from './forms.api';
import { fetchSections, saveSection as saveSectionRequest, setSectionArchived, type Section } from './sections.api';
import AIFormModal from './AIFormModal';
import ExcelFormImportModal from './ExcelFormImportModal';
import { moveFormItem, type DropPosition, type MovingItem } from './form-order';
import Pending from '../../components/feedback/Pending';
import LoadingState from '../../components/feedback/LoadingState';
import { RatingChoices } from './QuestionnaireChoices';

type Mode = 'forms' | 'templates';
type Selected = { type: 'question'; id: string } | { type: 'section'; id: number } | null;
const makeQuestion = (): FormQuestion => ({ id: crypto.randomUUID(), text: 'New question', type: 'Text', required: true, helpText: '' });
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const allQuestions = (blocks: FormBlock[]) => blocks.flatMap((block) => block.type === 'section' ? block.questions : [block.question]);
const choiceTypes = new Set(['Single choice', 'Multiple choice']);
const sectionKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const emptyOption = (): ChoiceOption => ({ id: crypto.randomUUID(), label: '' });
function optionsFor(question: FormQuestion): ChoiceOption[] {
  if (!Array.isArray(question.options)) return [];
  return question.options.map((option, index) => typeof option === 'string' ? { id: `legacy-${index}-${option}`, label: option } : option);
}
const initial = (name = 'Untitled form'): ReviewFormValues => ({ name, description: '', questions: [{ type: 'question', question: makeQuestion() }] });
function importedQuestion(question: AIGeneratedQuestion): FormQuestion {
  const base: FormQuestion = { id: question.id, text: question.text, type: question.type, required: question.required, helpText: question.helpText };
  if (question.type === 'Scale') return { ...base, scale_direction: 'higher_is_better', scale_min: question.scale_min ?? 1, scale_max: question.scale_max ?? 5, min_label: question.min_label ?? '', max_label: question.max_label ?? '', ...(question.scale_labels?.length ? { scale_labels: question.scale_labels } : {}) };
  if (choiceTypes.has(question.type)) return { ...base, options: question.options ?? [] };
  return base;
}
const sectionQuestions = (blocks: FormBlock[], id: number) => blocks.find((block) => block.type === 'section' && block.section_id === id)?.type === 'section' ? (blocks.find((block) => block.type === 'section' && block.section_id === id) as Extract<FormBlock, { type: 'section' }>).questions : [];
function isScale(question: FormQuestion) { return ['Scale', 'Scale 1-5', 'Scale 1-10'].includes(question.type); }

export default function Forms() {
  const { state, retryAuth0, getAccessToken: getAccessTokenSilently } = useAppAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const permissions = state.status === 'authenticated' ? state.user.permissions : [];
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
  const newFormMenu = useRef<HTMLDivElement>(null);
  const [newFormOpen, setNewFormOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [excelOpen, setExcelOpen] = useState(false);
  const editorNameInput = useRef<HTMLInputElement>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [draft, setDraft] = useState<ReviewFormValues | null>(null);
  const [saved, setSaved] = useState<ReviewFormValues | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formsError, setFormsError] = useState('');
  const [formLoadAttempt, setFormLoadAttempt] = useState(0);
  const [selected, setSelected] = useState<Selected>(null);
  const [message, setMessage] = useState('');
  const [aiDraftActive, setAiDraftActive] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [navigationSaveFailed, setNavigationSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveRequestPending = useRef(false);
  const navigationTrigger = useRef<HTMLElement | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [editingSection, setEditingSection] = useState<Section | null>(null);
  const [sectionPending, setSectionPending] = useState(false);
  const [sectionError, setSectionError] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const manageTrigger = useRef<HTMLButtonElement>(null);
  const [builderSectionName, setBuilderSectionName] = useState<string | null>(null);
  const [builderSectionError, setBuilderSectionError] = useState('');
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

  const archivedCount = forms.filter((item) => item.archivedAt !== null).length;
  const currentItems = mode === 'forms' ? forms.filter((item) => (item.archivedAt !== null) === showArchived) : templates;
  const selectedItem = selectedId === null ? null : (mode === 'forms' ? forms : templates).find((item) => item.id === selectedId) ?? null;
  // Archived forms open read-only until restored.
  const selectedArchived = mode === 'forms' && selectedItem?.archivedAt != null;
  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  // The editor's message line holds problems to fix, plus the reminder after an AI import. Successes go to toasts.
  const messageTone = message.startsWith('AI draft imported.') ? 'info' : 'error';
  const selectedQuestion = selected?.type === 'question' && draft ? allQuestions(draft.questions).find((question) => question.id === selected.id) ?? null : null;
  const sectionNameFor = (id: number) => sections.find((section) => section.id === id)?.name ?? `Section ${id}`;
  const createTemplate = templates.find((item) => item.id === createTemplateId);

  useEffect(() => {
    if (!newFormOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!newFormMenu.current?.contains(event.target as Node)) setNewFormOpen(false);
    }
    function onFocusIn(event: FocusEvent) {
      if (!newFormMenu.current?.contains(event.target as Node)) setNewFormOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setNewFormOpen(false); createTrigger.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = Array.from(newFormMenu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
      options[next].focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('keydown', onKeyDown); };
  }, [newFormOpen]);

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
    if (!pendingNavigation) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saveRequestPending.current) { setPendingNavigation(null); navigationTrigger.current?.focus(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(document.getElementById('forms-leave-dialog')?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pendingNavigation]);

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

  function choose(item: ReviewForm) { const next = { name: item.name, description: item.description, questions: copy(item.questions) }; setAiDraftActive(false); setSelectedId(item.id); setDraft(next); setSaved(copy(next)); setSelected(null); setPreviewOpen(false); setMessage(''); }
  function requestNavigation(action: () => void) {
    if (saveRequestPending.current) return;
    if (!dirty) { action(); return; }
    navigationTrigger.current = document.activeElement as HTMLElement;
    setNavigationSaveFailed(false);
    setPendingNavigation(() => action);
  }
  function selectItem(item: ReviewForm) {
    if (mode === 'forms' && item.id === selectedId) return;
    requestNavigation(() => choose(item));
  }
  function openCreate() {
    if (!canManageForms) return;
    requestNavigation(() => { setCreateName('Untitled form'); setCreateSource('scratch'); setCreateTemplateId(null); setCreateError(''); setCreateOpen(true); });
  }
  function openAI() {
    if (!canManageForms || mode === 'templates') return;
    requestNavigation(() => setAiOpen(true));
  }
  async function importAIForm(generated: AIGeneratedForm, mappings: Array<number | 'create'>) {
    if (!canManageForms || mappings.length !== generated.sections.length) throw new Error('Form import is unavailable.');
    const chosen = mappings.filter((item): item is number => typeof item === 'number');
    if (new Set(chosen).size !== chosen.length) throw new Error('Each suggested Section must use a different central Section.');
    let catalog = await fetchSections(getAccessTokenSilently);
    const used = new Set<number>();
    const blocks: FormBlock[] = [];
    for (const [index, section] of generated.sections.entries()) {
      const mapping = mappings[index];
      let target: Section | undefined;
      if (mapping === 'create') {
        if (!canManageSections || section.section_id !== null) throw new Error('Creating this Section is not permitted.');
        target = catalog.find((item) => sectionKey(item.name) === sectionKey(section.name));
        if (target?.is_archived) throw new Error(`Section “${section.name}” is archived. Choose another Section.`);
        if (!target) {
          try { target = await saveSectionRequest(getAccessTokenSilently, null, section.name); }
          catch (cause) {
            catalog = await fetchSections(getAccessTokenSilently);
            target = catalog.find((item) => !item.is_archived && sectionKey(item.name) === sectionKey(section.name));
            if (!target) throw cause;
          }
          if (!target) throw new Error(`Section “${section.name}” could not be created.`);
          const targetId = target.id;
          catalog = [...catalog.filter((item) => item.id !== targetId), target];
        }
      } else target = catalog.find((item) => item.id === mapping && !item.is_archived);
      if (!target) throw new Error(`Select an active Section for “${section.name}”.`);
      if (used.has(target.id)) throw new Error('Each suggested Section must use a different central Section.');
      used.add(target.id);
      blocks.push({ type: 'section', section_id: target.id, questions: section.questions.map(importedQuestion) });
    }
    blocks.push(...generated.standalone_questions.map((question): FormBlock => ({ type: 'question', question: importedQuestion(question) })));
    setSections(catalog.sort((a, b) => a.name.localeCompare(b.name)));
    setMode('forms'); setSelectedId(null); setSelected(null); setPreviewOpen(false);
    setDraft({ name: generated.name, description: generated.description, questions: blocks });
    setSaved(initial());
    setMessage('AI draft imported. Review the questions and save the form when ready.');
    setAiDraftActive(true);
    requestAnimationFrame(() => editorNameInput.current?.focus());
  }
  function openExcel() {
    if (!canManageForms) return;
    requestNavigation(() => setExcelOpen(true));
  }
  /** Opens an Excel-imported questionnaire as an unsaved draft of the current tab (form or template). */
  async function importExcelForm(imported: ExcelFormDraft) {
    if (!canManageForms) throw new Error('Form import is unavailable.');
    let catalog = await fetchSections(getAccessTokenSilently);
    const blocks: FormBlock[] = [];
    for (const block of imported.blocks) {
      if (block.type === 'question') { blocks.push({ type: 'question', question: importedQuestion(block.question) }); continue; }
      let target = block.section_id === null
        ? catalog.find((item) => sectionKey(item.name) === sectionKey(block.name))
        : catalog.find((item) => item.id === block.section_id);
      if (target?.is_archived) throw new Error(`Section “${block.name}” is archived. Restore it or use another section.`);
      if (!target) {
        if (!canManageSections) throw new Error(`Section “${block.name}” does not exist, and you are not allowed to create sections.`);
        try { target = await saveSectionRequest(getAccessTokenSilently, null, block.name); }
        catch (cause) {
          // Someone may have created it meanwhile; use theirs.
          catalog = await fetchSections(getAccessTokenSilently);
          target = catalog.find((item) => !item.is_archived && sectionKey(item.name) === sectionKey(block.name));
          if (!target) throw cause;
        }
        const created = target;
        catalog = [...catalog.filter((item) => item.id !== created.id), created];
      }
      blocks.push({ type: 'section', section_id: target.id, questions: block.questions.map(importedQuestion) });
    }
    setSections(catalog.sort((a, b) => a.name.localeCompare(b.name)));
    setExcelOpen(false); setSelectedId(null); setSelected(null); setPreviewOpen(false); setShowArchived(false);
    setDraft({ name: imported.name, description: imported.description, questions: blocks });
    setSaved(initial());
    setAiDraftActive(false);
    setMessage('');
    toast.success(`Imported from Excel. Review the ${mode === 'templates' ? 'template' : 'form'} and save it when ready.`);
    requestAnimationFrame(() => editorNameInput.current?.focus());
  }
  function startTemplate() {
    if (!canManageForms) return;
    requestNavigation(() => {
      const next = initial('Untitled template');
      setAiDraftActive(false); setSelectedId(null); setDraft(next); setSaved(copy(next)); setSelected(null); setPreviewOpen(false); setMessage('');
    });
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
      toast.success(`“${item.name}” created`);
      requestAnimationFrame(() => editorNameInput.current?.focus());
    } catch (error) { handleAccessError(error); setCreateError(`${error instanceof Error ? error.message : 'Form creation could not be confirmed.'} Check Your forms before retrying if the request timed out.`); }
    finally { createRequestPending.current = false; setCreatePending(false); }
  }
  function changeMode(nextMode: Mode) {
    if (nextMode === mode) return;
    requestNavigation(() => { setAiDraftActive(false); setNewFormOpen(false); setBuilderSectionName(null); setShowArchived(false); setMode(nextMode); setMessage(''); setSelectedId(null); setDraft(null); setSaved(null); setSelected(null); setPreviewOpen(false); setDragged(null); });
  }
  function backToOverview() {
    requestNavigation(() => { setAiDraftActive(false); setSelectedId(null); setDraft(null); setSaved(null); setSelected(null); setPreviewOpen(false); setBuilderSectionName(null); setMessage(''); });
  }
  function updateQuestion(id: string, patch: Partial<FormQuestion>) {
    setDraft((state) => state && ({ ...state, questions: state.questions.map((block) => block.type === 'question' ? block.question.id === id ? { ...block, question: { ...block.question, ...patch } } : block : { ...block, questions: block.questions.map((question) => question.id === id ? { ...question, ...patch } : question) }) }));
  }
  function appendQuestion(sectionId?: number) {
    const question = makeQuestion();
    setDraft((state) => state && ({ ...state, questions: sectionId === undefined ? [...state.questions, { type: 'question', question }] : state.questions.map((block) => block.type === 'section' && block.section_id === sectionId ? { ...block, questions: [...block.questions, question] } : block) }));
    setSelected({ type: 'question', id: question.id });
  }
  function appendSection(id: number) { setDraft((state) => state && (state.questions.some((block) => block.type === 'section' && block.section_id === id) ? state : { ...state, questions: [...state.questions, { type: 'section', section_id: id, questions: [] }] })); setSelected({ type: 'section', id }); }
  async function removeSection(id: number) {
    if (!(await confirm({ title: 'Remove this section from the form?', message: 'Its questions stay in the form as standalone questions. The section itself isn’t deleted.', confirmLabel: 'Remove section' }))) return;
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
  async function save(): Promise<boolean> {
    if (!draft || !canManageForms || saveRequestPending.current) return false;
    if (!draft.name.trim()) { setMessage('Name is required.'); return false; }
    saveRequestPending.current = true;
    setSaving(true);
    try {
      const payload = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
      const savedItem = mode === 'templates' ? selectedId === null ? await createFormTemplate(getAccessTokenSilently, payload) : await updateFormTemplate(getAccessTokenSilently, selectedId, payload) : selectedId === null ? await createForm(getAccessTokenSilently, payload) : await updateForm(getAccessTokenSilently, selectedId, payload);
      const setItems = mode === 'templates' ? setTemplates : setForms;
      setItems((items) => items.some((item) => item.id === savedItem.id) ? items.map((item) => item.id === savedItem.id ? savedItem : item) : [savedItem, ...items]);
      choose(savedItem); setMessage('');
      toast.success(`“${savedItem.name}” saved`);
      return true;
    } catch (error) { handleAccessError(error); setMessage(error instanceof Error ? error.message : 'Save failed.'); return false; }
    finally { saveRequestPending.current = false; setSaving(false); }
  }
  async function saveAndContinue() {
    if (!pendingNavigation) return;
    setNavigationSaveFailed(false);
    if (await save()) { const action = pendingNavigation; setPendingNavigation(null); action(); }
    else setNavigationSaveFailed(true);
  }
  function discardAndContinue() {
    if (!pendingNavigation || saveRequestPending.current) return;
    const action = pendingNavigation;
    setPendingNavigation(null);
    if (selectedId === null) { setDraft(null); setSaved(null); setSelected(null); }
    else if (saved) setDraft(copy(saved));
    action();
  }
  async function saveSection(builder = false): Promise<boolean> {
    const name = builder ? builderSectionName ?? '' : sectionName;
    const editing = builder ? null : editingSection;
    if (!canManageSections || !name.trim() || sectionRequestPending.current) return false;
    sectionRequestPending.current = true;
    setSectionPending(true); setSectionError(''); setBuilderSectionError('');
    try {
      const item = await saveSectionRequest(getAccessTokenSilently, editing?.id ?? null, name);
      setSections((items) => [...items.filter((section) => section.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)));
      if (builder) { setBuilderSectionName(null); appendSection(item.id); }
      else { setSectionName(''); setEditingSection(null); toast.success(editing ? `Section renamed to “${item.name}”` : `Section “${item.name}” created`); }
      return true;
    } catch (error) { handleAccessError(error); (builder ? setBuilderSectionError : setSectionError)(error instanceof Error ? error.message : 'Section save failed.'); return false; }
    finally { sectionRequestPending.current = false; setSectionPending(false); }
  }
  async function archiveSection(item: Section) {
    if (!canManageSections || sectionRequestPending.current) return;
    sectionRequestPending.current = true;
    setSectionPending(true); setSectionError('');
    try {
      const updated = await setSectionArchived(getAccessTokenSilently, item.id, !item.is_archived);
      setSections((items) => items.map((section) => section.id === updated.id ? updated : section));
      setEditingSection((current) => current?.id === updated.id ? updated : current);
      toast.success(updated.is_archived ? `Section “${updated.name}” archived` : `Section “${updated.name}” restored`);
    } catch (error) { handleAccessError(error); setSectionError(error instanceof Error ? error.message : 'Section update failed.'); }
    finally { sectionRequestPending.current = false; setSectionPending(false); }
  }
  function closeEditor() {
    setAiDraftActive(false); setSelectedId(null); setDraft(null); setSaved(null); setSelected(null); setPreviewOpen(false); setBuilderSectionName(null); setMessage('');
  }
  async function removeCurrent() {
    if (!selectedItem || !canManageForms || removing || saving) return;
    const item = selectedItem;
    const isTemplate = mode === 'templates';
    const archive = !isTemplate && item.usedInCampaigns;
    const unsaved = dirty ? ' Your unsaved changes are discarded too.' : '';
    const ok = await confirm(archive ? {
      title: `Archive “${item.name}”?`,
      message: `Campaigns use this form, so it’s archived instead of deleted: it leaves this list and the campaign pickers, but past campaigns and reports keep it. You can restore it any time.${unsaved}`,
      confirmLabel: 'Archive form',
    } : {
      title: `Delete “${item.name}”?`,
      message: isTemplate
        ? `The template is deleted permanently. Forms already created from it aren’t affected.${unsaved}`
        : `No campaign uses this form, so it’s deleted permanently.${unsaved}`,
      confirmLabel: isTemplate ? 'Delete template' : 'Delete form',
      tone: 'danger',
    });
    if (!ok) return;
    setRemoving(true); setMessage('');
    try {
      if (isTemplate) {
        await deleteFormTemplate(getAccessTokenSilently, item.id);
        setTemplates((items) => items.filter((template) => template.id !== item.id));
        toast.success(`Template “${item.name}” deleted`);
      } else {
        const result = await deleteForm(getAccessTokenSilently, item.id);
        setForms((items) => result.archived
          ? items.map((entry) => entry.id === item.id ? { ...entry, archivedAt: new Date().toISOString() } : entry)
          : items.filter((entry) => entry.id !== item.id));
        toast.success(result.archived ? `“${item.name}” archived` : `“${item.name}” deleted`);
      }
      closeEditor();
    } catch (error) {
      handleAccessError(error);
      setMessage(error instanceof Error ? error.message : 'The item could not be removed.');
    } finally {
      setRemoving(false);
    }
  }
  async function restoreCurrent() {
    if (!selectedItem || !canManageForms || removing) return;
    setRemoving(true); setMessage('');
    try {
      const restored = await restoreForm(getAccessTokenSilently, selectedItem.id);
      setForms((items) => items.map((entry) => entry.id === restored.id ? restored : entry));
      setShowArchived(false);
      choose(restored);
      toast.success(`“${restored.name}” restored`);
    } catch (error) {
      handleAccessError(error);
      setMessage(error instanceof Error ? error.message : 'The form could not be restored.');
    } finally {
      setRemoving(false);
    }
  }
  return <AppLayout activePage="forms" pageClassName="forms-page"><div className="main-content forms-editor-main">
    <section className="forms-page-header"><div><h1>Forms</h1><p>Create questionnaires with reusable analytical sections.</p></div></section>
    <nav className="forms-page-tabs" aria-label="Forms navigation"><div className="forms-page-tab-list"><button type="button" aria-current={mode === 'forms' ? 'page' : undefined} className={mode === 'forms' ? 'forms-page-tab active' : 'forms-page-tab'} onClick={() => changeMode('forms')}>Forms</button><button type="button" aria-current={mode === 'templates' ? 'page' : undefined} className={mode === 'templates' ? 'forms-page-tab active' : 'forms-page-tab'} onClick={() => changeMode('templates')}>Templates</button></div><button className="btn btn-secondary forms-manage-trigger" type="button" ref={manageTrigger} onClick={() => { setEditingSection(null); setSectionName(''); setManageOpen(true); }}><Layers3 size={16} aria-hidden="true" /> Manage sections</button></nav>
    <section className={`forms-editor-workspace${!draft ? ' forms-overview' : ''}`}><aside className="card forms-editor-card forms-list-panel"><div className="forms-editor-card-head"><div><h3>{showArchived ? 'Archived forms' : `Your ${mode}`}</h3><span>{currentItems.length} total</span>{mode === 'forms' && (archivedCount > 0 || showArchived) && <button type="button" className="forms-archived-toggle" onClick={() => requestNavigation(() => { closeEditor(); setShowArchived((value) => !value); })}>{showArchived ? 'Back to active forms' : `Archived (${archivedCount})`}</button>}</div>{canManageForms && !showArchived && (mode === 'templates' ? <div className="forms-panel-buttons"><button className="btn btn-secondary forms-panel-create" type="button" onClick={openExcel} title="Import a template from Excel"><FileSpreadsheet size={14} aria-hidden="true" /> Import</button><button className="btn btn-primary forms-panel-create" type="button" onClick={startTemplate}><Plus size={14} aria-hidden="true" /> New</button></div> : <div className="forms-new-form" ref={newFormMenu}><button className="btn btn-primary forms-panel-create forms-new-form-trigger" type="button" ref={createTrigger} aria-haspopup="menu" aria-expanded={newFormOpen} aria-controls="forms-new-form-menu" onClick={() => setNewFormOpen((open) => !open)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && !newFormOpen) { event.preventDefault(); setNewFormOpen(true); requestAnimationFrame(() => newFormMenu.current?.querySelector<HTMLButtonElement>(`[role="menuitem"]:${event.key === 'ArrowUp' ? 'last' : 'first'}-child`)?.focus()); } }}><Plus size={14} aria-hidden="true" /> New <ChevronDown size={13} aria-hidden="true" /></button>
      {newFormOpen && <div id="forms-new-form-menu" className="forms-new-form-menu" role="menu" aria-label="New form"><button type="button" role="menuitem" onClick={() => { setNewFormOpen(false); createTrigger.current?.focus(); openCreate(); }}><FilePlus2 size={18} aria-hidden="true" /><span><strong>Create manually</strong><small>Start with a blank questionnaire</small></span></button><button type="button" role="menuitem" onClick={() => { setNewFormOpen(false); createTrigger.current?.focus(); openAI(); }}><Sparkles size={18} aria-hidden="true" /><span><strong>Generate with AI</strong><small>Generate a draft to review and edit</small></span></button><button type="button" role="menuitem" onClick={() => { setNewFormOpen(false); createTrigger.current?.focus(); openExcel(); }}><FileSpreadsheet size={18} aria-hidden="true" /><span><strong>Import from Excel</strong><small>Upload a filled-in form template</small></span></button></div>}</div>)}</div>
      {mode === 'forms' && formsError && <div className="forms-editor-state"><InlineMessage tone="error">{formsError}</InlineMessage><button className="btn btn-secondary" disabled={formsLoading} onClick={() => { setFormsError(''); setFormsLoading(true); setFormLoadAttempt((attempt) => attempt + 1); }}>Retry loading forms</button></div>}
      {mode === 'forms' && formsLoading && <LoadingState variant="section" label="Loading forms" />}
      {mode === 'forms' && !formsLoading && !formsError && currentItems.length === 0 && <div className="forms-editor-state">{showArchived ? 'No archived forms.' : 'No forms yet. Create a form to start building your questionnaire.'}</div>}
      {mode === 'templates' && templatesError && <div className="forms-editor-state"><InlineMessage tone="error">{templatesError}</InlineMessage><button className="btn btn-secondary" disabled={templatesLoading} onClick={() => { setTemplatesError(''); setTemplatesLoading(true); setTemplateLoadAttempt((attempt) => attempt + 1); }}>Retry loading templates</button></div>}
      {mode === 'templates' && templatesLoading && <LoadingState variant="section" label="Loading templates" />}
      {mode === 'templates' && !templatesLoading && !templatesError && templates.length === 0 && <div className="forms-editor-state">No templates yet. Create a template to reuse a questionnaire.</div>}
      <div className={`forms-editor-list${!draft ? ' forms-overview-list' : ''}`}>{currentItems.map((item) => <button key={item.id} className={`forms-editor-form-item${item.id === selectedId ? ' active' : ''}`} onClick={() => selectItem(item)}>{!draft ? <><FileText className="forms-overview-icon" size={18} aria-hidden="true" /><span className="forms-overview-details"><strong>{item.name}</strong></span><span className="forms-overview-count">{allQuestions(item.questions).length} questions</span><ChevronRight className="forms-overview-chevron" size={16} aria-hidden="true" /></> : <><strong>{item.name}</strong><span>{allQuestions(item.questions).length} questions</span></>}</button>)}</div></aside>
      {draft && <><section className="card forms-editor-card forms-editor-panel"><button className="forms-editor-back" type="button" onClick={backToOverview}><ArrowLeft size={16} aria-hidden="true" /> Back to {mode}</button>{draft && (!canManageForms || selectedArchived) ? <div className="forms-editor-empty"><h2>{draft.name}</h2><p>{allQuestions(draft.questions).length} questions · {selectedArchived ? 'Archived' : 'Read-only access'}</p>{selectedArchived && <InlineMessage tone="info">Past campaigns and reports still use this form. Restore it to edit it or use it in new campaigns.</InlineMessage>}{message && <InlineMessage tone={messageTone}>{message}</InlineMessage>}<div className="forms-editor-header-actions"><button className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>Preview questionnaire</button>{selectedArchived && canManageForms && <button className="btn btn-primary" type="button" disabled={removing} onClick={() => { void restoreCurrent(); }}>{removing ? <Pending label="Restoring" /> : 'Restore form'}</button>}</div></div> : draft ? <><div className="forms-editor-header"><div className="forms-editor-header-title"><h2>{draft.name}</h2><p>{allQuestions(draft.questions).length} questions</p></div><div className="forms-editor-header-actions">{selectedItem && <button className="btn btn-secondary forms-remove-button" type="button" disabled={removing || saving} onClick={() => { void removeCurrent(); }}>{mode === 'forms' && selectedItem.usedInCampaigns ? <><Archive size={14} aria-hidden="true" /> Archive</> : <><Trash2 size={14} aria-hidden="true" /> Delete</>}</button>}<button className="btn btn-secondary" onClick={() => setPreviewOpen(true)}>Preview</button><button className="btn btn-secondary" disabled={!dirty || saving} onClick={() => { if (saved) setDraft(copy(saved)); setSelected(null); }}>Discard</button><button className="btn btn-primary" disabled={!dirty || saving} onClick={() => { void save(); }}>{saving ? <Pending label="Saving" /> : 'Save changes'}</button></div></div>
        <label className="form-field forms-editor-field"><span className="form-label">Name</span><input className="form-control" aria-label="Name" ref={editorNameInput} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="form-field forms-editor-field"><span className="form-label">Description</span><textarea className="form-control" aria-label="Description" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>{aiDraftActive && selectedId === null && <p className="forms-ai-label" role="note"><strong>AI-generated draft.</strong> Check every question for accuracy, fairness and tone before saving; you are responsible for the final questionnaire.</p>}{message && <InlineMessage tone={messageTone} className="forms-editor-inline-message">{message}</InlineMessage>}
          <div className="forms-editor-section"><div className="forms-editor-section-head"><h3>Questionnaire structure</h3><div><button className="btn btn-secondary" onClick={() => appendQuestion()}>Add question</button><select className="form-control" aria-label="Add section" value="" onChange={(event) => { if (event.target.value === 'create') { setBuilderSectionName(''); setBuilderSectionError(''); } else if (event.target.value) appendSection(Number(event.target.value)); }}><option value="">Add section</option>{sections.filter((section) => !section.is_archived && !draft.questions.some((block) => block.type === 'section' && block.section_id === section.id)).map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}{canManageSections && <option value="create">Create new section...</option>}</select></div></div>
            {builderSectionName !== null && <form className="forms-builder-section-create" onSubmit={(event) => { event.preventDefault(); void saveSection(true); }}><label className="form-field forms-editor-field"><span className="form-label">New reusable section name</span><input className="form-control" autoFocus value={builderSectionName} disabled={sectionPending} onChange={(event) => { setBuilderSectionName(event.target.value); setBuilderSectionError(''); }} /></label><button className="btn btn-primary" type="submit" disabled={sectionPending || !builderSectionName.trim()}>{sectionPending ? <Pending label="Creating" /> : 'Create and add'}</button><button className="btn btn-secondary" type="button" disabled={sectionPending} onClick={() => { setBuilderSectionName(null); setBuilderSectionError(''); }}>Cancel</button>{builderSectionError && <InlineMessage tone="error">{builderSectionError}</InlineMessage>}</form>}
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
              {(mode === 'forms' ? formsLoading : templatesLoading) ? <LoadingState variant="section" label={`Loading ${mode}`} />
                : (mode === 'forms' ? formsError : templatesError) ? <InlineMessage tone="error">{mode === 'forms' ? formsError : templatesError}</InlineMessage>
                  : <>
                    <h2>{currentItems.length === 0 ? `No ${mode} yet` : mode === 'forms' ? 'No form selected' : 'No template selected'}</h2>
                    <p>{currentItems.length === 0 ? mode === 'forms' ? 'No questionnaires are available.' : 'No templates are available.' : `Select an existing ${mode === 'forms' ? 'form' : 'template'} from the list${canManageForms ? ', or create a new one.' : '.'}`}</p>
                    {canManageForms && <button className="btn btn-primary" type="button" onClick={mode === 'forms' ? openCreate : startTemplate}>New {mode === 'forms' ? 'form' : 'template'}</button>}
                  </>}
            </div>}</section>
         <aside className="card forms-editor-card forms-editor-settings-panel"><div className="forms-editor-card-head"><h3>{draft && selected?.type === 'section' ? 'Section settings' : 'Question settings'}</h3></div>{!canManageForms ? <div className="forms-editor-state">Read-only access. Use Preview to view the questionnaire.</div> : !draft ? <div className="forms-editor-state">Settings will appear when a form or template is open.</div> : selected?.type === 'section' ? <div className="forms-editor-props"><h3>{sectionNameFor(selected.id)}</h3><p>{sectionQuestions(draft.questions, selected.id).length} questions</p><button className="btn btn-secondary" onClick={() => appendQuestion(selected.id)}>Add question</button><button className="forms-editor-delete-link" onClick={() => removeSection(selected.id)}>Remove section from form</button></div> : selectedQuestion ? <QuestionEditor question={selectedQuestion} sections={sections.filter((section) => !section.is_archived || draft.questions.some((block) => block.type === 'section' && block.section_id === section.id))} current={draft.questions.find((block) => block.type === 'section' && block.questions.some((question) => question.id === selectedQuestion.id))?.type === 'section' ? (draft.questions.find((block) => block.type === 'section' && block.questions.some((question) => question.id === selectedQuestion.id)) as Extract<FormBlock, { type: 'section' }>).section_id : null} onUpdate={(patch) => updateQuestion(selectedQuestion.id, patch)} onMove={(id) => moveQuestion(selectedQuestion.id, id)} onDelete={() => deleteQuestion(selectedQuestion.id)} /> : <div className="forms-editor-state">Select a question or section to edit it.</div>}</aside></>}</section>
    {manageOpen && <ManageSections sections={sections} name={sectionName} editing={editingSection} pending={sectionPending} error={sectionError} canManage={canManageSections} onName={setSectionName} onEdit={(item) => { setEditingSection(item); setSectionName(item?.name ?? ''); setSectionError(''); }} onSave={() => saveSection()} onArchive={archiveSection} onClose={() => { setManageOpen(false); setEditingSection(null); setSectionName(''); manageTrigger.current?.focus(); }} />}
    {pendingNavigation && <div className="forms-editor-modal-backdrop" role="presentation"><div className="forms-editor-modal forms-leave-modal" id="forms-leave-dialog" role="dialog" aria-modal="true" aria-labelledby="forms-leave-title" aria-describedby="forms-leave-description">
      <div className="forms-editor-modal-head"><div><h3 id="forms-leave-title">Unsaved changes</h3><p id="forms-leave-description">Save this questionnaire before leaving, or discard your changes.</p></div></div>
      {navigationSaveFailed && <InlineMessage tone="error" className="forms-leave-error">{message}</InlineMessage>}
      <div className="forms-editor-modal-actions"><button className="btn btn-secondary" type="button" autoFocus disabled={saving} onClick={() => { setPendingNavigation(null); navigationTrigger.current?.focus(); }}>Stay and continue editing</button><button className="btn btn-secondary" type="button" disabled={saving} onClick={discardAndContinue}>Discard changes</button><button className="btn btn-primary" type="button" disabled={saving || !canManageForms} onClick={() => { void saveAndContinue(); }}>{saving ? <Pending label="Saving" /> : 'Save and continue'}</button></div>
    </div></div>}
    {createOpen && <div className="forms-editor-modal-backdrop" role="presentation"><div className="forms-editor-modal forms-create-modal" id="forms-create-dialog" role="dialog" aria-modal="true" aria-labelledby="forms-create-title" aria-describedby="forms-create-subtitle">
      <div className="forms-editor-modal-head"><div><h3 id="forms-create-title">Create form</h3><p id="forms-create-subtitle">Choose how to start your questionnaire.</p></div><button className="forms-editor-modal-close" type="button" aria-label="Close" disabled={createPending} onClick={closeCreate}>×</button></div>
      <div className="forms-editor-modal-body"><label className="form-field forms-editor-field"><span className="form-label">Form name</span><input className="form-control" aria-label="Form name" autoFocus value={createName} disabled={createPending} onChange={(event) => { setCreateName(event.target.value); setCreateError(''); }} /></label>
        <button type="button" className={`forms-create-option${createSource === 'scratch' ? ' active' : ''}`} aria-pressed={createSource === 'scratch'} disabled={createPending} onClick={() => { setCreateSource('scratch'); setCreateError(''); }}><strong>Start from scratch</strong><span>Create an empty questionnaire and add your own sections and questions.</span></button>
        <button type="button" className={`forms-create-option${createSource === 'template' ? ' active' : ''}`} aria-pressed={createSource === 'template'} disabled={createPending} onClick={() => { setCreateSource('template'); setCreateError(''); }}><strong>Start from a template</strong><span>Choose an existing questionnaire template.</span></button>
        {createSource === 'template' && <div className="forms-create-templates">
          {templatesLoading ? <LoadingState variant="section" label="Loading templates" /> : templatesError ? <><InlineMessage tone="error">{templatesError}</InlineMessage><button className="btn btn-secondary" type="button" disabled={createPending} onClick={() => { setTemplatesError(''); setTemplatesLoading(true); setTemplateLoadAttempt((attempt) => attempt + 1); }}>Retry loading templates</button></> : templates.length === 0 ? <p>No templates available yet.</p> : templates.map((item) => <button key={item.id} type="button" className={`forms-create-template${item.id === createTemplateId ? ' active' : ''}`} aria-pressed={item.id === createTemplateId} disabled={createPending} onClick={() => { setCreateTemplateId(item.id); setCreateName(`${item.name} copy`); setCreateError(''); }}><strong>{item.name}</strong><span>{allQuestions(item.questions).length} {allQuestions(item.questions).length === 1 ? 'question' : 'questions'}</span>{item.description && <small>{item.description}</small>}</button>)}
        </div>}
        {createError && <InlineMessage tone="error">{createError}</InlineMessage>}
      </div>
      <div className="forms-editor-modal-actions"><button className="btn btn-secondary" type="button" disabled={createPending} onClick={closeCreate}>Cancel</button><button className="btn btn-primary" type="button" disabled={createPending || !createName.trim() || (createSource === 'template' && (!createTemplate || !!templatesError || templatesLoading))} onClick={confirmCreate}>{createPending ? <Pending label="Creating" /> : 'Create form'}</button></div>
    </div></div>}
    {excelOpen && <ExcelFormImportModal kind={mode === 'templates' ? 'template' : 'form'} getAccessToken={getAccessTokenSilently} onImport={importExcelForm} onClose={() => setExcelOpen(false)} />}
    {aiOpen && <AIFormModal sections={sections} canManageSections={canManageSections} getAccessToken={getAccessTokenSilently} onImport={importAIForm} onClose={() => { setAiOpen(false); createTrigger.current?.focus(); }} />}
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
/** Labelling every value (an anchored scale) is offered for scales of at most this many values. */
const MAX_LABELLED_SCALE_POINTS = 11;
const scalePoints = (question: FormQuestion) => (question.scale_max ?? 5) - (question.scale_min ?? 1) + 1;
/** In every-value mode the endpoint labels mirror the first and last value label, for screens that only show those. */
function withValueLabels(labels: string[]): Partial<FormQuestion> {
  return { scale_labels: labels, min_label: labels[0] ?? '', max_label: labels[labels.length - 1] ?? '' };
}
function scaleRange(question: FormQuestion, minimum: number, maximum: number): Partial<FormQuestion> {
  const patch: Partial<FormQuestion> = { scale_min: minimum, scale_max: maximum, scale_direction: 'higher_is_better' };
  if (!Array.isArray(question.scale_labels)) return patch;
  const points = maximum - minimum + 1;
  if (!Number.isInteger(points) || points < 2 || points > MAX_LABELLED_SCALE_POINTS) return patch;
  const current = question.scale_labels as string[];
  return { ...patch, ...withValueLabels(Array.from({ length: points }, (_value, index) => current[index] ?? '')) };
}
function ScaleLabelsEditor({ question, onUpdate }: { question: FormQuestion; onUpdate: (patch: Partial<FormQuestion>) => void }) {
  const minimum = question.scale_min ?? 1;
  const points = scalePoints(question);
  const everyValue = Array.isArray(question.scale_labels);
  const allowed = Number.isInteger(points) && points >= 2 && points <= MAX_LABELLED_SCALE_POINTS;
  const labels = everyValue ? question.scale_labels as string[] : [];
  function setMode(next: boolean) {
    if (next === everyValue) return;
    if (next) onUpdate(withValueLabels(Array.from({ length: points }, (_value, index) => index === 0 ? question.min_label ?? '' : index === points - 1 ? question.max_label ?? '' : '')));
    else onUpdate({ scale_labels: undefined });
  }
  return <div className="forms-scale-labels">
    <div className="forms-scale-labels-mode" role="radiogroup" aria-label="Scale labels">
      <span className="form-label">Labels</span>
      <label><input type="radio" name={`labels-${question.id}`} checked={!everyValue} onChange={() => setMode(false)} />Lowest and highest only</label>
      <label title={allowed ? undefined : `Available for scales of at most ${MAX_LABELLED_SCALE_POINTS} values.`}><input type="radio" name={`labels-${question.id}`} checked={everyValue} disabled={!allowed && !everyValue} onChange={() => setMode(true)} />Every value</label>
    </div>
    {!everyValue && <>
      {!allowed && <p className="forms-editor-hint">Every value can be labelled on scales of at most {MAX_LABELLED_SCALE_POINTS} values.</p>}
      <label className="form-field forms-editor-field"><span className="form-label">Lowest rating label</span><input className="form-control" value={question.min_label ?? ''} onChange={(event) => onUpdate({ min_label: event.target.value })} /></label>
      <label className="form-field forms-editor-field"><span className="form-label">Highest rating label</span><input className="form-control" value={question.max_label ?? ''} onChange={(event) => onUpdate({ max_label: event.target.value })} /></label>
    </>}
    {everyValue && <>
      <p className="forms-editor-hint">Describe what each value means, so everyone rates the same way.{!allowed && ` Shorten the scale to at most ${MAX_LABELLED_SCALE_POINTS} values.`}</p>
      {allowed && <div className="forms-scale-label-list">{labels.map((label, index) => <label className="forms-scale-label-row" key={index}>
        <span className="forms-scale-label-value">{minimum + index}</span>
        <input className="form-control" aria-label={`Label for ${minimum + index}`} value={label} maxLength={120} placeholder={index === 0 ? 'e.g. Rarely meets expectations' : index === labels.length - 1 ? 'e.g. Consistently exceeds expectations' : ''} onChange={(event) => onUpdate(withValueLabels(labels.map((item, position) => position === index ? event.target.value : item)))} />
      </label>)}</div>}
    </>}
  </div>;
}
function QuestionEditor({ question, sections, current, onUpdate, onMove, onDelete }: { question: FormQuestion; sections: Section[]; current: number | null; onUpdate: (patch: Partial<FormQuestion>) => void; onMove: (id: number | null) => void; onDelete: () => void }) {
  const options = optionsFor(question);
  function updateOptions(next: ChoiceOption[]) { onUpdate({ options: next }); }
  function moveOption(index: number, direction: -1 | 1) { const target = index + direction; if (target < 0 || target >= options.length) return; const next = [...options]; const [option] = next.splice(index, 1); next.splice(target, 0, option); updateOptions(next); }
  return <div className="forms-editor-props">
    <button className="forms-editor-delete-link" onClick={onDelete}>Delete question</button>
    <label className="form-field forms-editor-field"><span className="form-label">Question text</span><textarea className="form-control" aria-label="Question text" value={question.text} onChange={(event) => onUpdate({ text: event.target.value })} /></label>
    <label className="form-field forms-editor-field"><span className="form-label">Question type</span><select className="form-control" aria-label="Question type" value={question.type} onChange={(event) => { const type = event.target.value; onUpdate({ type, options: choiceTypes.has(type) ? question.options ?? [] : undefined, ...(isScale({ ...question, type }) ? { scale_min: question.scale_min ?? 1, scale_max: question.scale_max ?? 5, scale_direction: 'higher_is_better' } : { scale_labels: undefined }) }); }}>
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
      <label className="form-field forms-editor-field"><span className="form-label">Minimum</span><input className="form-control" type="number" value={question.scale_min ?? 1} onChange={(event) => onUpdate(scaleRange(question, Number(event.target.value), question.scale_max ?? 5))} /></label>
      <label className="form-field forms-editor-field"><span className="form-label">Maximum</span><input className="form-control" type="number" value={question.scale_max ?? 5} onChange={(event) => onUpdate(scaleRange(question, question.scale_min ?? 1, Number(event.target.value)))} /></label>
      <ScaleLabelsEditor question={question} onUpdate={onUpdate} />
    </>}
    <label className="forms-editor-switch"><span>Required question</span><input type="checkbox" checked={question.required} onChange={(event) => onUpdate({ required: event.target.checked })} /></label>
  </div>;
}
function ManageSections({ sections, name, editing, pending, error, canManage, onName, onEdit, onSave, onArchive, onClose }: { sections: Section[]; name: string; editing: Section | null; pending: boolean; error: string; canManage: boolean; onName: (name: string) => void; onEdit: (section: Section | null) => void; onSave: () => Promise<boolean>; onArchive: (section: Section) => void; onClose: () => void }) {
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [creating, setCreating] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const newTrigger = useRef<HTMLButtonElement>(null);
  function cancelEdit() {
    setCreating(false); onEdit(null);
    requestAnimationFrame(() => newTrigger.current?.focus());
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (pending) return;
        if (creating || editing) { setCreating(false); onEdit(null); requestAnimationFrame(() => newTrigger.current?.focus()); }
        else onClose();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
      if (!controls.length) return;
      if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); controls[0].focus(); }
      else if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [creating, editing, pending, onClose, onEdit]);
  async function submitSection(event: FormEvent) {
    event.preventDefault();
    if (!validName || pending) return;
    if (await onSave()) {
      setCreating(false); setFilter('active');
      requestAnimationFrame(() => newTrigger.current?.focus());
    }
  }
  const visible = sections.filter((section) => section.is_archived === (filter === 'archived'));
  const validName = !!name.trim() && name.trim().replace(/\s+/g, ' ').length <= 120;
  return <div className="forms-editor-modal-backdrop" role="presentation"><div ref={dialog} className="forms-editor-modal forms-sections-modal" role="dialog" aria-modal="true" aria-labelledby="forms-sections-title">
    <div className="forms-editor-modal-head forms-sections-head"><h3 id="forms-sections-title">Manage sections</h3><div>{canManage && <button ref={newTrigger} className="btn btn-secondary forms-section-new" type="button" autoFocus disabled={pending || creating || !!editing} onClick={() => { onEdit(null); setFilter('active'); setCreating(true); }}><Plus size={14} aria-hidden="true" /> New</button>}<button className="forms-editor-modal-close" type="button" aria-label="Close Manage sections" autoFocus={!canManage} disabled={pending} onClick={onClose}><X size={17} aria-hidden="true" /></button></div></div>
    <div className="forms-sections-content">
      <div className="forms-sections-filters" role="group" aria-label="Section status"><button type="button" className={filter === 'active' ? 'active' : ''} aria-pressed={filter === 'active'} disabled={pending || creating || !!editing} onClick={() => setFilter('active')}>Active</button><button type="button" className={filter === 'archived' ? 'active' : ''} aria-pressed={filter === 'archived'} disabled={pending || creating || !!editing} onClick={() => setFilter('archived')}>Archived</button></div>
      {error && <InlineMessage tone="error" className="forms-sections-inline-message">{error}</InlineMessage>}
      {creating && <form className="forms-section-inline" onSubmit={(event) => { void submitSection(event); }}><input className="form-control" aria-label="New section name" placeholder="Section name" autoFocus value={name} disabled={pending} onChange={(event) => onName(event.target.value)} /><button className="btn btn-primary" type="submit" disabled={pending || !canManage || !validName}>{pending ? <Pending label="Creating" /> : 'Create'}</button><button className="btn btn-secondary" type="button" disabled={pending} onClick={cancelEdit}>Cancel</button>{name.trim().replace(/\s+/g, ' ').length > 120 && <small className="forms-option-error">Use 120 characters or fewer.</small>}</form>}
      <div className="forms-sections-list">{visible.length === 0 && <p className="forms-sections-empty">No {filter} sections.</p>}{visible.map((section) => <div className="forms-section-row" key={section.id}>
        {editing?.id === section.id ? <form className="forms-section-inline" onSubmit={(event) => { void submitSection(event); }}><input className="form-control" aria-label={`Rename ${section.name}`} autoFocus value={name} disabled={pending} onChange={(event) => onName(event.target.value)} /><button className="btn btn-primary" type="submit" disabled={pending || !canManage || !validName}>{pending ? <Pending label="Saving" /> : 'Save'}</button><button className="btn btn-secondary" type="button" disabled={pending} onClick={cancelEdit}>Cancel</button>{name.trim().replace(/\s+/g, ' ').length > 120 && <small className="forms-option-error">Use 120 characters or fewer.</small>}</form> : <><div className="forms-section-label"><strong>{section.name}</strong><span>{section.is_archived ? 'Archived' : 'Active'}</span></div><div className="forms-section-actions">{!section.is_archived && <button className="btn btn-secondary" type="button" disabled={pending || !canManage} onClick={() => onEdit(section)}>Rename</button>}<button className="btn btn-secondary" type="button" disabled={pending || !canManage} onClick={() => onArchive(section)}>{section.is_archived ? 'Restore' : 'Archive'}</button></div></>}
      </div>)}</div>
    </div>
  </div></div>;
}
function Preview({ draft, name, onClose }: { draft: ReviewFormValues; name: (id: number) => string; onClose: () => void }) { return <div className="forms-preview-backdrop"><div className="forms-preview-modal"><div className="forms-preview-topbar"><div><h3>Questionnaire preview</h3><span className="forms-preview-mode">Preview mode</span></div><button className="forms-editor-modal-close" onClick={onClose}>×</button></div><div className="forms-preview-body"><div className="forms-preview-paper"><h2>{draft.name}</h2>{draft.questions.map((block, blockIndex) => <div key={blockIndex}>{block.type === 'section' && <h3 className="forms-preview-section-title">{name(block.section_id)}</h3>}{(block.type === 'section' ? block.questions : [block.question]).map((question, questionIndex) => { const index = draft.questions.slice(0, blockIndex).reduce((count, previous) => count + (previous.type === 'section' ? previous.questions.length : 1), questionIndex + 1); const min = question.scale_min ?? 1; const max = question.scale_max ?? 5; return <div className="forms-preview-question" key={question.id}><strong>{index}. {question.text} {question.required && '*'}</strong>{isScale(question) && Array.isArray(question.scale_labels) ? <RatingChoices name={question.id} min={min} max={max} minLabel={question.min_label} maxLabel={question.max_label} labels={question.scale_labels as string[]} /> : isScale(question) ? <div className="forms-preview-scale-group"><div className="forms-preview-scale">{Array.from({ length: max - min + 1 }, (_, value) => <label key={value}><input type="radio" name={question.id} />{min + value}</label>)}</div><div className="forms-preview-endpoints"><span>{question.min_label || 'Lowest rating'}</span><span>{question.max_label || 'Highest rating'}</span></div></div> : choiceTypes.has(question.type) ? <div className="forms-preview-choice-group">{optionsFor(question).map((option) => <label key={option.id}><input type={question.type === 'Single choice' ? 'radio' : 'checkbox'} name={question.id} /> {option.label}</label>)}</div> : <textarea className="form-control" placeholder="Preview response" />}</div>; })}</div>)}</div></div><div className="forms-preview-footer"><span>Responses are not saved.</span><button className="btn btn-primary" onClick={onClose}>Close preview</button></div></div></div>; }
