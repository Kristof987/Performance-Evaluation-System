import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Trash2, X } from 'lucide-react';
import { FeedbackContext, type ConfirmOptions, type FeedbackApi, type ToastTone } from './feedback-context';
import './feedback.css';

/*
 * One place for action feedback:
 * - success -> toast (auto-hides), errors -> InlineMessage next to the action (or an error toast
 *   when there is no natural place for it), field errors under the field;
 * - irreversible, bulk, permission-granting, costly or finalizing actions -> confirm first.
 */

const SUCCESS_TIMEOUT_MS = 5000;

interface Toast { id: number; tone: ToastTone; message: string }

interface PendingConfirm { options: ConfirmOptions; resolve: (ok: boolean) => void }

function ConfirmDialog({ options, onClose }: { options: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = options.tone === 'danger';

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    // Capture phase, so drawers and modals underneath don't react to these keys.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(false); }
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation();
        (document.activeElement === cancelRef.current ? confirmRef : cancelRef).current?.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus?.(); };
  }, [onClose]);

  const Icon = danger ? Trash2 : HelpCircle;
  return createPortal(
    <div className="confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(false); }}>
      <div className={`confirm-dialog${danger ? ' confirm-dialog-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby={options.message ? 'confirm-dialog-message' : undefined}>
        <div className="confirm-dialog-head">
          <span className="confirm-dialog-icon"><Icon size={18} aria-hidden="true" /></span>
          <div>
            <h2 id="confirm-dialog-title">{options.title}</h2>
            {options.message && <p id="confirm-dialog-message" className="confirm-dialog-message">{options.message}</p>}
          </div>
        </div>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={() => onClose(false)}>{options.cancelLabel ?? 'Cancel'}</button>
          <button ref={confirmRef} type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => onClose(true)}>{options.confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) { window.clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const show = useCallback((tone: ToastTone, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, tone, message }]);
    if (tone === 'success') timers.current.set(id, window.setTimeout(() => dismiss(id), SUCCESS_TIMEOUT_MS));
  }, [dismiss]);

  useEffect(() => {
    const active = timers.current;
    return () => { active.forEach((timer) => window.clearTimeout(timer)); active.clear(); };
  }, []);

  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false);
    pendingRef.current = { options, resolve };
    setPending(pendingRef.current);
  }), []);

  const close = useCallback((ok: boolean) => {
    pendingRef.current?.resolve(ok);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const api = useMemo<FeedbackApi>(() => ({
    confirm,
    toast: {
      success: (message) => show('success', message),
      warning: (message) => show('warning', message),
      error: (message) => show('error', message),
    },
  }), [confirm, show]);

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {pending && <ConfirmDialog options={pending.options} onClose={close} />}
      {createPortal(
        <div className="toast-region" aria-live="polite">
          {toasts.map((toast) => {
            const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'warning' ? AlertTriangle : AlertCircle;
            return (
              <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'success' ? 'status' : 'alert'}>
                <Icon size={18} aria-hidden="true" />
                <span className="toast-message">{toast.message}</span>
                <button type="button" className="feedback-dismiss toast-dismiss" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}><X size={14} aria-hidden="true" /></button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </FeedbackContext.Provider>
  );
}
