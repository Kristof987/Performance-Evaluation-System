import InlineMessage from './InlineMessage';

/** Something that couldn't load, with a way to try again. */
export default function LoadError({ message, onRetry, retryLabel = 'Retry', className }: {
  message: string;
  onRetry: () => void;
  retryLabel?: string;
  className?: string;
}) {
  return <InlineMessage tone="error" className={`load-error${className ? ` ${className}` : ''}`}>
    <span>{message}</span>
    <button className="load-error-retry" type="button" onClick={onRetry}>{retryLabel}</button>
  </InlineMessage>;
}
