import { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { AccessTokenGetter } from '../../auth/authenticated-api';
import InlineMessage from '../../components/feedback/InlineMessage';
import Pending from '../../components/feedback/Pending';
import { importFormFromExcel, type ExcelFormDraft } from './forms.api';

const templateUrl = new URL('../../resources/upload_form_empty_template.xlsx', import.meta.url).href;
/** Same limit as the server; checked here so a too large file fails before it is uploaded. */
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export default function ExcelFormImportModal({ kind, getAccessToken, onImport, onClose }: {
  kind: 'form' | 'template';
  getAccessToken: AccessTokenGetter;
  onImport: (draft: ExcelFormDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const fileProblem = file === null ? '' : !file.name.toLowerCase().endsWith('.xlsx') ? 'Choose an .xlsx file.' : file.size > MAX_IMPORT_BYTES ? 'The file is larger than 2 MB.' : '';

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('input, a, button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled)') ?? []);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pending, onClose]);

  async function upload() {
    if (!file || fileProblem || pending) return;
    setPending(true);
    setError('');
    setRowErrors([]);
    try {
      const result = await importFormFromExcel(getAccessToken, file);
      if (result.errors.length || !result.form) { setRowErrors(result.errors); setError('Nothing was imported. Fix these rows and upload the file again.'); return; }
      await onImport(result.form);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Excel file could not be imported.');
    } finally {
      setPending(false);
    }
  }

  return <div className="forms-editor-modal-backdrop" role="presentation"><div ref={dialog} className="forms-editor-modal forms-excel-modal" role="dialog" aria-modal="true" aria-labelledby="forms-excel-title" aria-describedby="forms-excel-description">
    <div className="forms-editor-modal-head"><div><h3 id="forms-excel-title">Import {kind} from Excel</h3><p id="forms-excel-description">Fill in the template and upload it. The {kind} opens in the editor to review; nothing is saved until you save it there.</p></div><button type="button" className="forms-editor-modal-close" aria-label="Close" disabled={pending} onClick={onClose}>X</button></div>
    <div className="forms-editor-modal-body forms-excel-body">
      <ol className="forms-excel-steps">
        <li><a className="forms-excel-template" href={templateUrl} download="upload_form_empty_template.xlsx"><FileSpreadsheet size={16} aria-hidden="true" />Download the template</a><small>Its Instructions sheet explains every column. Up to 200 questions, 2 MB.</small></li>
        <li><label className="file-picker forms-excel-picker"><input type="file" accept=".xlsx" disabled={pending} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); setRowErrors([]); }} /><span>{file?.name ?? 'Choose the filled-in file'}</span></label></li>
      </ol>
      {fileProblem && <InlineMessage tone="error">{fileProblem}</InlineMessage>}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {rowErrors.length > 0 && <ul className="forms-excel-errors">{rowErrors.map((item) => <li key={item}>{item}</li>)}</ul>}
    </div>
    <div className="forms-editor-modal-actions"><button className="btn btn-secondary" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="btn btn-primary" type="button" disabled={!file || !!fileProblem || pending} onClick={upload}>{pending ? <Pending label="Reading file" /> : 'Import'}</button></div>
  </div></div>;
}
