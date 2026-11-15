import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle } from 'lucide-react';
import type { CampaignEvaluationRules, CampaignGroupEvaluationMatrix } from '../campaign.types';
import { clearMatrixPairs, matrixCell, matrixKey, matrixSelectedCount, type MatrixSelection } from '../matrix.utils';

type Props = {
  group: CampaignGroupEvaluationMatrix;
  notice?: ReactNode;
  groups: CampaignGroupEvaluationMatrix[];
  onGroupChange: (groupId: number) => void;
  rules: CampaignEvaluationRules;
  selfForms: Record<number, number | null>;
  selection: MatrixSelection;
  matrixDirty: boolean;
  rulesDirty: boolean;
  editable: boolean;
  disabledReason: string;
  minimum: string;
  onMinimumChange: (minimum: string) => void;
  saving: boolean;
  saveDisabled: boolean;
  saveError: string;
  autosaveBlockedReason: string;
  message: string;
  onToggle: (groupId: number, evaluatorId: number, evaluateeId: number) => void;
  onAddAll: (groupId: number) => void;
  onAddSelf: (groupId: number) => void;
  onGenerate: (groupId: number, minimum: number) => void;
  onClear: (groupId: number) => void;
  onSave: () => void;
  onDiscard: () => void;
};

function MatrixRequirementIndicator({ reason }: { reason: string }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  function show() {
    const rect = indicator.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 62 > window.innerHeight ? Math.max(8, rect.top - 60) : rect.bottom + 7,
      left: Math.max(8, Math.min(rect.left - 100, window.innerWidth - 248)),
    });
  }
  useEffect(() => {
    if (!position) return;
    function onScroll() { setPosition(null); }
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [position]);
  return <><span ref={indicator} className="campaign-matrix-requirement" tabIndex={0} role="img" aria-label={reason} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}><AlertCircle size={14} aria-hidden="true" /></span>{position && createPortal(<span className="campaign-matrix-requirement-popover" role="tooltip" style={position}>{reason}</span>, document.body)}</>;
}

export default function EvaluationMatrix({ group, notice, groups, onGroupChange, rules, selfForms, selection, matrixDirty, rulesDirty, editable, disabledReason, minimum, onMinimumChange, saving, saveDisabled, saveError, autosaveBlockedReason, message, onToggle, onAddAll, onAddSelf, onGenerate, onClear, onSave, onDiscard }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const confirmRef = useRef<HTMLDivElement>(null);
  const clearTrigger = useRef<HTMLButtonElement>(null);
  const clearable = matrixSelectedCount(selection, group.groupId) - matrixSelectedCount(clearMatrixPairs(group, rules, selection, selfForms), group.groupId);
  const selectedCount = matrixSelectedCount(selection, group.groupId);
  const validForms = new Set(rules.forms.map((form) => form.id));
  const roleForms = new Map<string, number | null>(rules.groups.find((item) => item.groupId === group.groupId)?.rolePairs.map((pair): [string, number | null] => [
    `${pair.evaluatorRoleId}:${pair.evaluateeRoleId}`, pair.formId,
  ]) ?? []);
  useEffect(() => {
    if (!confirmClear) return;
    confirmRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirmClear(false);
        clearTrigger.current?.focus();
      }
      if (event.key === 'Tab' && confirmRef.current) {
        const focusable = [...confirmRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmClear]);
  function generate() {
    const value = Number(minimum);
    if (minimum.trim() === '' || !Number.isInteger(value) || value < 0 || value > 100) {
      setValidationMessage('Enter a whole number from 0 to 100.');
      return;
    }
    setValidationMessage('');
    onGenerate(group.groupId, value);
  }
  return (
      <div className="campaign-matrix-inline">
        <div className="campaign-matrix-inline-header">
          <div>
            <h2 id="campaign-matrix-title">Evaluation matrix — {group.groupName}</h2>
            <p>Select which employees evaluate which other employees.</p>
            <p className="campaign-matrix-selection-count">{selectedCount} {selectedCount === 1 ? 'pair' : 'pairs'} selected</p>
          </div>
          {groups.length > 1 && <label className="campaign-matrix-group-picker">Group<select className="form-control" value={group.groupId} onChange={(event) => onGroupChange(Number(event.target.value))}>{groups.map((item) => <option key={item.groupId} value={item.groupId}>{item.groupName}</option>)}</select></label>}
        </div>
        {notice}
        <div className="campaign-matrix-inline-table-wrap">
          <table className="campaign-matrix-table">
            <thead><tr><th scope="col">Evaluator ↓ / Evaluatee →</th>{group.employees.map((employee) =>
              <th scope="col" key={employee.id}><span>{employee.name}</span><small>{employee.roleName}</small></th>
            )}</tr></thead>
            <tbody>{group.employees.map((evaluator) =>
              <tr key={evaluator.id}>
                <th scope="row"><span>{evaluator.name}</span><small>{evaluator.roleName}</small></th>
                {group.employees.map((evaluatee) => {
                   const cell = matrixCell(group, rules, evaluator.id, evaluatee.id, selfForms);
                   const key = matrixKey(group.groupId, evaluator.id, evaluatee.id);
                   const assignment = group.assignments.find((item) => item.evaluatorId === evaluator.id && item.evaluateeId === evaluatee.id);
                   const selected = Boolean(selection[key]);
                   const missingReason = !selected || assignment?.issued ? '' : evaluator.id === evaluatee.id
                     ? (assignment ? assignment.formId == null : selfForms[evaluator.id] == null) ? 'This selected self-evaluation pair needs an individual questionnaire before issuance.' : ''
                     : (assignment ? !validForms.has(assignment.formId ?? -1) : !validForms.has(roleForms.get(`${evaluator.roleId}:${evaluatee.roleId}`) ?? -1)) ? 'This selected peer pair needs a role-based questionnaire before issuance.' : '';
                   const reason = cell.reason || (rulesDirty ? 'Save questionnaire assignments before editing the evaluation matrix.' : disabledReason);
                   return <td className={evaluator.id === evaluatee.id ? 'campaign-matrix-self' : undefined} key={evaluatee.id}>
                     <span className="campaign-matrix-cell-content"><span className="campaign-matrix-cell-control" tabIndex={reason ? 0 : undefined} title={reason || undefined} aria-label={reason ? `${evaluator.name} evaluates ${evaluatee.name}. ${reason}` : undefined}>
                       <input type="checkbox" checked={selected} disabled={saving || !editable || Boolean(reason)} aria-label={`${evaluator.name} evaluates ${evaluatee.name}${assignment && selected ? `, ${assignment.issued ? 'issued' : 'planned'}` : selected ? ', staged plan' : ''}${missingReason ? `. ${missingReason}` : ''}`} onChange={() => onToggle(group.groupId, evaluator.id, evaluatee.id)} />
                       {reason && <span className="campaign-matrix-cell-reason" role="tooltip">{reason}</span>}
                     </span>{missingReason ? <MatrixRequirementIndicator reason={missingReason} /> : assignment && selected && <small className={`campaign-matrix-assignment-status ${assignment.issued ? 'issued' : 'planned'}`}>{assignment.issued ? 'Issued' : 'Planned'}</small>}</span>
                  </td>;
                })}
              </tr>
            )}</tbody>
          </table>
        </div>
        <div className="campaign-matrix-tools" role="group" aria-label="Matrix selection tools">
          <div className="campaign-matrix-selection-tools"><span>Selection</span><div>
            <button className="btn btn-secondary" type="button" disabled={saving || !editable || rulesDirty} onClick={() => onAddAll(group.groupId)}>Add all eligible</button>
            <button className="btn btn-secondary" type="button" disabled={saving || !editable || rulesDirty} onClick={() => onAddSelf(group.groupId)}>Add self-evaluations</button>
          </div></div>
          <div className="campaign-matrix-generate-tools"><span>Automatic generation</span><div><label htmlFor="minimum-reviewers-input">Minimum incoming peer reviews</label>
            <input id="minimum-reviewers-input" className="form-control" type="number" min="0" max="100" step="1" value={minimum} disabled={saving || !editable || rulesDirty} onChange={(event) => onMinimumChange(event.target.value)} />
            <button className="btn btn-secondary" type="button" disabled={saving || !editable || rulesDirty} onClick={generate}>Generate</button>
          </div></div>
          <div className="campaign-matrix-clear-tools"><button ref={clearTrigger} className="btn btn-secondary campaign-matrix-danger-btn" type="button" disabled={saving || !editable || rulesDirty || clearable === 0} onClick={() => setConfirmClear(true)}>Clear editable selections</button></div>
        </div>
        <div className="campaign-matrix-footer">
            <div className="campaign-matrix-autosave-feedback">
              <span role="status">{saving ? 'Saving evaluation assignments...' : matrixDirty ? saveError ? 'Changes not saved.' : autosaveBlockedReason || 'Waiting to save automatically...' : saveError ? 'Saved; refresh required.' : 'Evaluation assignments saved automatically.'} No questionnaires are issued by automatic saving.</span>
              {saveError && <span className="campaign-matrix-autosave-error" role="alert">{saveError}</span>}
              {(validationMessage || message) && <span role="status">{validationMessage || message}</span>}
            </div>
            <div className="campaign-matrix-save-actions">
              {matrixDirty && !saving && <button className="btn btn-secondary" type="button" onClick={onDiscard}>Discard changes</button>}
              {matrixDirty && saveError && <button className="btn btn-secondary" type="button" disabled={saveDisabled} onClick={onSave}>Retry saving</button>}
            </div>
        </div>
         {confirmClear && <div ref={confirmRef} className="campaign-matrix-confirm" role="alertdialog" aria-label="Clear matrix selections" aria-modal="true">
           <div><h3>Clear matrix selections</h3><p>This removes editable selections in this group and saves automatically. Issued or completed evaluations will not be deleted.</p>
              <div className="campaign-modal-actions"><button className="btn btn-secondary" type="button" onClick={() => { setConfirmClear(false); clearTrigger.current?.focus(); }}>Cancel</button><button className="btn btn-secondary campaign-matrix-danger-btn" type="button" disabled={saving || !editable} onClick={() => { onClear(group.groupId); setConfirmClear(false); clearTrigger.current?.focus(); }}>Clear selections</button></div>
           </div>
         </div>}
      </div>
  );
}
