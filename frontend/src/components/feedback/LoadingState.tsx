import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import './feedback.css';

/** Waiting this long before showing anything keeps fast loads from flashing a spinner. */
const SHOW_AFTER_MS = 400;

type Variant = 'screen' | 'page' | 'section';

/**
 * Something is loading. `label` is the action without an ellipsis ("Loading campaigns").
 * - screen: the whole window (account check before the app opens)
 * - page: a card-sized placeholder where a page or list will appear
 * - section: one part of a card
 */
export default function LoadingState({ label, variant = 'section', className }: { label: string; variant?: Variant; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return <div className={`loading-state loading-state-${variant}${className ? ` ${className}` : ''}`} role="status" aria-busy="true">
    {visible && <><Loader2 className="loading-spinner" size={variant === 'section' ? 16 : 18} aria-hidden="true" /><span>{label}…</span></>}
  </div>;
}
