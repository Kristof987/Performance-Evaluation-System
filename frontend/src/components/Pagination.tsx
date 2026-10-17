import './Pagination.css';

type PaginationProps = {
  pagination: { page: number; pages: number; from: number; to: number };
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
};

export default function Pagination({ pagination, total, noun, onPageChange }: PaginationProps) {
  return <div className="table-footer">
    <span>Showing {pagination.from}–{pagination.to} of {total} {noun}</span>
    <div className="pager">
      <button type="button" disabled={pagination.page === 1} onClick={() => onPageChange(pagination.page - 1)}>← Previous</button>
      <span>Page {pagination.page} / {pagination.pages}</span>
      <button type="button" disabled={pagination.page === pagination.pages} onClick={() => onPageChange(pagination.page + 1)}>Next →</button>
    </div>
  </div>;
}
