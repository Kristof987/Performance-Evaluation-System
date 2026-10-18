import { useEffect, useRef, useState } from 'react';
import type { CampaignEvaluationRules, CampaignGroupEvaluationMatrix } from '../campaign.types';
import { clearMatrixPairs, matrixCell, matrixKey, matrixSelectedCount, type MatrixSelection } from '../matrix.utils';
import { countLabel } from '../rule-copy';

type Props = {
  group: CampaignGroupEvaluationMatrix;
  rules: CampaignEvaluationRules;
  selfForms: Record<number, number | null>;
  selfFormsDirty: boolean;
  selection: MatrixSelection;
  dirty: boolean;
  rulesDirty: boolean;
  staged?: boolean;
  saving: boolean;
  message: string;
  onClose: () => void;
  onToggle: (groupId: number, evaluatorId: number, evaluateeId: number) => void;
  onAddAll: (groupId: number) => void;
  onAddSelf: (groupId: number) => void;
  onGenerate: (groupId: number, minimum: number) => void;
  onClear: (groupId: number) => void;
  onSave: () => void;
  onDiscard: () => void;
  onReviewSelf: () => void;
};

export default function EvaluationMatrixModal({ group, rules, selfForms, selfFormsDirty, selection, dirty, rulesDirty, staged = false, saving, message, onClose, onToggle, onAddAll, onAddSelf, onGenerate, onClear, onSave, onDiscard, onReviewSelf }: Props) {
  const [minimum, setMinimum] = useState('1');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const clearable = matrixSelectedCount(selection, group.groupId) - matrixSelectedCount(clearMatrixPairs(group, rules, selection, selfForms), group.groupId);
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { openerRef.current?.focus(); };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmClear) setConfirmClear(false);
        else if (confirmClose) setConfirmClose(false);
        else if (dirty && !staged) setConfirmClose(true);
        else onClose();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const scope = (confirmClose || confirmClear ? dialogRef.current.querySelector<HTMLElement>('.campaign-matrix-confirm') : dialogRef.current) ?? dialogRef.current;
        const focusable = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmClear, confirmClose, dirty, staged, onClose]);
  useEffect(() => {
    if (confirmClose || confirmClear) dialogRef.current?.querySelector<HTMLElement>('.campaign-matrix-confirm button')?.focus();
  }, [confirmClose, confirmClear]);
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
    <div className="campaign-modal-backdrop" role="presentation">
      <section ref={dialogRef} className="campaign-modal campaign-matrix-modal" role="dialog" aria-modal="true" aria-labelledby="campaign-matrix-title">
        <div className="campaign-modal-header campaign-matrix-modal-header">
          <div>
            <h2 id="campaign-matrix-title">Evaluation Matrix — {group.groupName}</h2>
            <p>{countLabel(group.employees.length, 'employee')} · {countLabel(matrixSelectedCount(selection, group.groupId), 'evaluation pair')} selected</p>
            <p>Saved assignments before the campaign starts are planned. Issued assignments cannot be changed.</p>
          </div>
          <button className="campaign-modal-close" type="button" aria-label="Close evaluation matrix" onClick={() => { if (dirty && !staged) setConfirmClose(true); else onClose(); }}>×</button>
        </div>
        {rulesDirty && <div className="campaign-matrix-warning">Save form rules before editing the evaluation matrix.</div>}
        {selfFormsDirty && <div className="campaign-matrix-warning">Save self-evaluation forms before editing the matrix diagonals.</div>}
        {group.employees.some((employee) => selfForms[employee.id] == null) && <div className="campaign-matrix-prerequisite">
          <p>Some diagonal cells need a self-evaluation form before they can be selected. Peer pairs remain available.</p>
          <button className="campaign-link" type="button" onClick={onReviewSelf}>Review self-evaluation forms</button>
        </div>}
        <div className="campaign-matrix-modal-table-wrap">
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
                  const reason = rulesDirty ? 'Save form rules before editing the evaluation matrix.' : evaluator.id === evaluatee.id && selfFormsDirty && !selection[key] ? 'Save self-evaluation forms before selecting diagonal assignments.' : cell.reason;
                  return <td className={evaluator.id === evaluatee.id ? 'campaign-matrix-self' : undefined} key={evaluatee.id}>
                    <span className="campaign-matrix-cell-control" tabIndex={reason ? 0 : undefined} title={reason || undefined} aria-label={reason ? `${evaluator.name} evaluates ${evaluatee.name}. ${reason}` : undefined}>
                      <input type="checkbox" checked={Boolean(selection[key])} disabled={saving || Boolean(reason)} aria-label={`${evaluator.name} evaluates ${evaluatee.name}${assignment && selection[key] ? `, ${assignment.issued ? 'issued' : 'planned'}` : ''}`} onChange={() => onToggle(group.groupId, evaluator.id, evaluatee.id)} />
                      {reason && <span className="campaign-matrix-cell-reason" role="tooltip">{reason}</span>}
                    </span>
                     {assignment && selection[key] && <small className={`campaign-matrix-assignment-status ${assignment.issued ? 'issued' : 'planned'}`}>{assignment.issued ? 'Issued' : 'Planned'}</small>}
                  </td>;
                })}
              </tr>
            )}</tbody>
          </table>
        </div>
        <div className="campaign-matrix-tools">
          <div className="campaign-matrix-tool-group"><span>Selection tools</span>
             <button className="btn btn-secondary" type="button" disabled={saving || rulesDirty || selfFormsDirty} onClick={() => onAddAll(group.groupId)}>Add all eligible</button>
             <button className="btn btn-secondary" type="button" disabled={saving || rulesDirty || selfFormsDirty} onClick={() => onAddSelf(group.groupId)}>Add self-evaluations</button>
          </div>
          <div className="campaign-matrix-tool-group"><label htmlFor="minimum-reviewers-input">Minimum incoming peer reviews</label>
            <input id="minimum-reviewers-input" className="form-control" type="number" min="0" max="100" step="1" value={minimum} disabled={rulesDirty} onChange={(event) => setMinimum(event.target.value)} />
             <button className="btn btn-secondary" type="button" disabled={saving || rulesDirty} onClick={generate}>Generate</button>
          </div>
           <button className="btn btn-secondary campaign-matrix-danger-btn" type="button" disabled={saving || rulesDirty || clearable === 0} onClick={() => setConfirmClear(true)}>Clear editable selections</button>
        </div>
        <div className="campaign-matrix-modal-footer">
           <span>{dirty ? 'Unsaved changes · ' : ''}Changes are staged until {staged ? 'Save setup changes on the campaign page' : 'Save matrix'} is clicked.{validationMessage || message ? ` ${validationMessage || message}` : ''}</span>
           {!staged && <button className="btn btn-primary" type="button" disabled={saving || !dirty || rulesDirty} onClick={onSave}>
             {saving ? 'Saving...' : 'Save matrix'}
           </button>}
        </div>
        {confirmClear && <div className="campaign-matrix-confirm" role="alertdialog" aria-label="Clear matrix selections" aria-modal="true">
          <div><h3>Clear matrix selections</h3><p>This removes editable selections in this group. Issued or completed evaluations will not be deleted.</p>
            <div className="campaign-modal-actions"><button className="btn btn-secondary" type="button" onClick={() => setConfirmClear(false)}>Cancel</button><button className="btn btn-secondary campaign-matrix-danger-btn" type="button" onClick={() => { onClear(group.groupId); setConfirmClear(false); }}>Clear selections</button></div>
          </div>
        </div>}
        {confirmClose && <div className="campaign-matrix-confirm" role="alertdialog" aria-label="Close matrix with unsaved changes" aria-modal="true">
          <div><h3>Unsaved matrix changes</h3><p>Your selections remain staged on this page until Save matrix or Discard changes is clicked.</p>
            <div className="campaign-modal-actions"><button className="btn btn-secondary" type="button" onClick={() => setConfirmClose(false)}>Continue editing</button><button className="btn btn-secondary" type="button" onClick={onClose}>Keep staged changes</button><button className="btn btn-primary" type="button" onClick={() => { onDiscard(); onClose(); }}>Discard and close</button></div>
          </div>
        </div>}
      </section>
    </div>
  );
}
