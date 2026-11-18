import InlineMessage from '../../../components/feedback/InlineMessage';

/** A report part that couldn't load, with a way to try again. */
export default function ReportsLoadError({ message, onRetry, retryLabel = 'Retry', className }: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return <InlineMessage tone="error" className={`reports-load-error${className ? ` ${className}` : ''}`}>
    <span>{message}</span>
    <button className="reports-text-button" type="button" onClick={onRetry}>{retryLabel}</button>
  </InlineMessage>;
}
