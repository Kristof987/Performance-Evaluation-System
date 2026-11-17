import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import './feedback.css';

export type InlineMessageTone = 'success' | 'error' | 'warning' | 'info';

const ICONS = { success: CheckCircle2, error: AlertCircle, warning: AlertTriangle, info: Info };

interface InlineMessageProps {
  tone: InlineMessageTone;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

/** A message shown next to the action or form it belongs to. */
export default function InlineMessage({ tone, children, onDismiss, className }: InlineMessageProps) {
  const Icon = ICONS[tone];
  const urgent = tone === 'error' || tone === 'warning';
  return (
    <div className={`inline-message inline-message-${tone}${className ? ` ${className}` : ''}`} role={urgent ? 'alert' : 'status'}>
      <Icon size={16} aria-hidden="true" />
      <div className="inline-message-body">{children}</div>
      {onDismiss && <button type="button" className="feedback-dismiss" aria-label="Dismiss message" onClick={onDismiss}><X size={14} aria-hidden="true" /></button>}
    </div>
  );
}
