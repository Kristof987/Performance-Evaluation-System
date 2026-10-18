import { useEffect, useRef, type ReactNode } from 'react';
type Props = {
  mode: 'create' | 'edit' | 'copy-role' | 'copy-group' | 'copy-self' | 'remove-group' | 'review' | 'close';
  onClose: () => void;
  children: ReactNode;
};
export default function CampaignModal({
  mode,
  onClose,
  children,
}: Props) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  const isCreate = mode === 'create';
  const titleId = `${mode}-campaign-title`;
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    const handleFocus = (event: FocusEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        dialogRef.current.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
      }
    };
    document.addEventListener('focusin', handleFocus);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('focusin', handleFocus);
      document.body.classList.remove('modal-open');
      openerRef.current?.focus();
    };
  }, []);
  return (
    <div className="campaign-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="campaign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="campaign-modal-header">
          <div>
            <h2 id={titleId}>
               {isCreate ? 'Create campaign' : mode === 'review' ? 'Move to review' : mode === 'close' ? 'Close campaign' : mode === 'copy-role' ? 'Copy role pair' : mode === 'copy-group' ? 'Copy group rules' : mode === 'copy-self' ? 'Copy self-evaluation form' : mode === 'remove-group' ? 'Remove campaign groups' : 'Edit campaign'}
            </h2>
            <p>
               {isCreate ? 'Set up a new performance review campaign.' : mode === 'review' || mode === 'close' ? 'Review the latest operational completion before confirming.' : mode === 'copy-role' ? "Apply this role pair's form assignment to matching groups." : mode === 'copy-group' ? "Apply this group's matching role-to-form rules to other selected groups." : mode === 'copy-self' ? 'Apply this questionnaire to other employees in the campaign.' : mode === 'remove-group' ? 'Review the configuration affected by this change.' : 'Update the campaign details and schedule.'}
            </p>
          </div>
          <button
            className="campaign-modal-close"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
