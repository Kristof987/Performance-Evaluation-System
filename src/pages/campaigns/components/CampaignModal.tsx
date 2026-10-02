import { useEffect, type ReactNode } from 'react';
type Props = {
  mode: 'create' | 'edit';
  issuedFormsCount?: number;
  onClose: () => void;
  children: ReactNode;
};
export default function CampaignModal({
  mode,
  issuedFormsCount = 0,
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
  return (
    <div className="campaign-modal-backdrop" role="presentation">
      <section
        className="campaign-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="campaign-modal-header">
          <div>
            <span className="campaign-modal-eyebrow">
              {isCreate ? 'New campaign' : 'Edit campaign'}
            </span>
            <h2 id={titleId}>
              {isCreate ? 'Create campaign' : 'Edit Campaign'}
            </h2>
            <p>
              {isCreate ? (
                'Fill the fields from the Campaign model before assigning forms and groups.'
              ) : (
                <>
                  Update the campaign details and period. {issuedFormsCount}{' '}
                  questionnaires have been issued.
                </>
              )}
            </p>
          </div>
          <button
            className="campaign-modal-close"
            type="button"
            aria-label={`Close ${mode} campaign`}
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
