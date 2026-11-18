import { Loader2 } from 'lucide-react';
import './feedback.css';

/** Button or status text while an action runs: a small spinner and "Saving…". Pass the label without an ellipsis. */
export default function Pending({ label }: { label: string }) {
  return <span className="pending-label"><Loader2 className="loading-spinner" size={14} aria-hidden="true" />{label}…</span>;
}
