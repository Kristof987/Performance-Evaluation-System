export default function ReportsEmptyState({ title, message }: { title: string; message: string }) {
  return <div className="reports-empty"><strong>{title}</strong><span>{message}</span></div>;
}
