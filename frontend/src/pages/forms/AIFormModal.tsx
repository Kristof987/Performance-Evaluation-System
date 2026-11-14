import { useEffect, useRef, useState } from 'react';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import { generateAIForm, type AIGenerateRequest, type AIGeneratedForm, type AIGeneratedQuestion } from './forms.api';
import type { Section } from './sections.api';

type Mapping = number | 'create' | null;

export default function AIFormModal({ sections, canManageSections, getAccessToken, onImport, onClose }: {
  sections: Section[];
  canManageSections: boolean;
  getAccessToken: AccessTokenGetter;
  onImport: (draft: AIGeneratedForm, mappings: Array<number | 'create'>) => Promise<void>;
  onClose: () => void;
}) {
  const [request, setRequest] = useState<AIGenerateRequest>({ description: '', evaluation_type: 'peer', length: 'standard' });
  const [generated, setGenerated] = useState<AIGeneratedForm | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [pending, setPending] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const descriptionInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    descriptionInput.current?.focus();
    return () => activeRequest.current?.abort();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !importing) { activeRequest.current?.abort(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), select:not(:disabled)') ?? []);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [importing, onClose]);

  async function generate() {
    if (!request.description.trim() || pending || importing) { setError('Describe the questionnaire before generating.'); return; }
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(true); setError('');
    try {
      const draft = await generateAIForm(getAccessToken, { ...request, description: request.description.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      setGenerated(draft);
      setMappings(draft.sections.map((item) => item.section_id));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Generation failed. Please retry.');
    } finally {
      if (!controller.signal.aborted) setPending(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  async function importDraft() {
    if (!generated || importing || mappings.some((item) => item === null)) return;
    setImporting(true); setError('');
    try {
      await onImport(generated, mappings as Array<number | 'create'>);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import the draft.'); }
    finally { setImporting(false); }
  }

  function close() { if (importing) return; activeRequest.current?.abort(); onClose(); }
  const disabled = pending || importing;
  return <div className="forms-editor-modal-backdrop" role="presentation"><div ref={dialog} className="forms-editor-modal forms-ai-modal" role="dialog" aria-modal="true" aria-labelledby="forms-ai-title" aria-describedby="forms-ai-description">
    <div className="forms-editor-modal-head"><div><h3 id="forms-ai-title">Generate with AI</h3><p id="forms-ai-description">Create a draft to review and edit in the Forms Builder. Nothing is saved automatically.</p></div><button type="button" className="forms-editor-modal-close" aria-label="Close" disabled={importing} onClick={close}>X</button></div>
    <div className="forms-editor-modal-body forms-ai-body">
      <label className="form-field forms-editor-field"><span className="form-label">Description</span><textarea ref={descriptionInput} className="form-control" rows={4} maxLength={3000} value={request.description} disabled={disabled} placeholder="Describe the roles and skills this questionnaire should assess..." onChange={(event) => setRequest({ ...request, description: event.target.value })} /></label>
      <div className="forms-ai-options"><label className="form-field forms-editor-field"><span className="form-label">Evaluation type</span><select className="form-control" value={request.evaluation_type} disabled={disabled} onChange={(event) => setRequest({ ...request, evaluation_type: event.target.value as AIGenerateRequest['evaluation_type'] })}><option value="peer">Peer evaluation</option><option value="self">Self-evaluation</option><option value="manager">Manager evaluation</option></select></label>
        <label className="form-field forms-editor-field"><span className="form-label">Length</span><select className="form-control" value={request.length} disabled={disabled} onChange={(event) => setRequest({ ...request, length: event.target.value as AIGenerateRequest['length'] })}><option value="short">Short (5-8)</option><option value="standard">Standard (10-15)</option><option value="detailed">Detailed (18-25)</option></select></label></div>
      {error && <p className="forms-option-error" role="alert">{error}</p>}
      {pending && <p role="status" className="forms-ai-status">Generating and checking your draft. Invalid results are corrected automatically...</p>}
      {generated && <div className="forms-ai-preview"><div className="forms-ai-preview-heading"><h4>{generated.name}</h4><span>{generated.sections.reduce((sum, item) => sum + item.questions.length, generated.standalone_questions.length)} questions</span></div>{generated.description && <p>{generated.description}</p>}
        {generated.sections.map((section, index) => <section key={index} className="forms-ai-section"><div className="forms-ai-section-heading"><strong>{section.name}</strong>{section.section_id !== null && <small>Existing section</small>}{section.section_id === null && <small>Proposed new section</small>}</div>
          <label className="form-field forms-editor-field"><span className="form-label">Use central section</span><select className="form-control" disabled={disabled} value={mappings[index] ?? ''} onChange={(event) => setMappings((current) => current.map((value, position) => position === index ? event.target.value === 'create' ? 'create' : event.target.value ? Number(event.target.value) : null : value))}><option value="">Choose an existing section or approve a new one</option>{sections.filter((item) => !item.is_archived).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{section.section_id === null && canManageSections && <option value="create">Create new central section: {section.name}</option>}</select></label>
          <ol>{section.questions.map((question) => <li key={question.id}><QuestionSummary question={question} /></li>)}</ol></section>)}
        {generated.standalone_questions.length > 0 && <section className="forms-ai-section"><strong>Other Questions</strong><ol>{generated.standalone_questions.map((question) => <li key={question.id}><QuestionSummary question={question} /></li>)}</ol></section>}
        {generated.sections.some((item) => item.section_id === null) && <p className="forms-ai-note">Proposed Sections are created only if you choose Create new and confirm the import. You can instead select an existing Section. A Section created during import remains in the catalog if a later step fails.</p>}
      </div>}
    </div>
    <div className="forms-editor-modal-actions"><button className="btn btn-secondary" type="button" disabled={importing} onClick={close}>Cancel</button>{generated && <button className="btn btn-secondary" type="button" disabled={disabled} onClick={generate}>Regenerate</button>}{generated ? <button className="btn btn-primary" type="button" disabled={disabled || mappings.some((item) => item === null)} onClick={importDraft}>{importing ? 'Importing...' : 'Edit in Form Builder'}</button> : <button className="btn btn-primary" type="button" disabled={disabled || !request.description.trim()} onClick={generate}>{pending ? 'Generating...' : 'Generate draft'}</button>}</div>
  </div></div>;
}

function QuestionSummary({ question }: { question: AIGeneratedQuestion }) {
  return <><span>{question.text}</span><small>{question.type}{question.required ? ' / Required' : ' / Optional'}{question.type === 'Scale' ? ` / ${question.scale_min}-${question.scale_max}` : ''}</small>{question.type === 'Scale' && <small>{question.min_label} to {question.max_label}</small>}{question.options?.length ? <small>{question.options.map((option) => option.label).join(' / ')}</small> : null}</>;
}
