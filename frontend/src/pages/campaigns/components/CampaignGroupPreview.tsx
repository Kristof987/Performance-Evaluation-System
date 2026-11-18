import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { Employee } from '../../people/people.api';
import type { CampaignGroup } from '../campaign.types';
import LoadingState from '../../../components/feedback/LoadingState';

const pageSize = 10;

export default function CampaignGroupPreview({ employees, selectedGroups, loading, error }: {
  employees: Employee[] | null;
  selectedGroups: CampaignGroup[];
  loading: boolean;
  error: string;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const selectedKey = selectedGroups.map((group) => group.id).join(',');

  useEffect(() => { setPage(1); }, [query, selectedKey]);

  const members = new Map<number, { employee: Employee; groups: string[] }>();
  for (const employee of employees ?? []) {
    if (employee.status !== 'Active') continue;
    const groups = selectedGroups.filter((group) => employee.groupIds.includes(group.id)).map((group) => group.name);
    if (groups.length) members.set(employee.id, { employee, groups });
  }
  const sorted = [...members.values()].sort((a, b) => a.employee.name.localeCompare(b.employee.name) || a.employee.id - b.employee.id);
  const filtered = sorted.filter(({ employee }) => employee.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const numbers = [...new Set([1, 2, currentPage - 1, currentPage, currentPage + 1, pages - 1, pages])]
    .filter((number) => number >= 1 && number <= pages).sort((a, b) => a - b);

  return <section className="campaign-group-preview" aria-labelledby="campaign-group-preview-title">
    <div className="campaign-group-preview-head"><div><h2 id="campaign-group-preview-title">Group preview</h2><p>Employees in selected campaign groups.</p></div><span>{employees ? `${sorted.length} employees` : 'Employees'}</span></div>
    <div className="campaign-group-preview-search"><Search size={16} aria-hidden="true" /><input className="form-control" type="search" aria-label="Search employees by name" placeholder="Search employees..." value={query} disabled={!selectedGroups.length || !employees || loading || !!error} onChange={(event) => setQuery(event.target.value)} /></div>
    {!selectedGroups.length ? <p className="campaign-group-preview-empty">Select campaign groups to preview their employees.</p> : loading || !employees && !error ? <LoadingState variant="section" label="Loading employees" /> : error ? <p className="campaign-group-preview-empty" role="alert">{error}</p> : filtered.length === 0 ? <p className="campaign-group-preview-empty">{query.trim() ? 'No employees match your search.' : 'Selected groups have no active employees.'}</p> : <>
      <div className="campaign-group-preview-table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Group</th></tr></thead><tbody>{shown.map(({ employee, groups }) => <tr key={employee.id}><th scope="row">{employee.name}</th><td>{employee.role}</td><td>{groups.join(', ')}</td></tr>)}</tbody></table></div>
      <div className="campaign-group-preview-pagination"><span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} employees</span>{pages > 1 && <nav aria-label="Employee preview pages"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>{numbers.map((number, index) => <span key={number}>{index > 0 && number > numbers[index - 1] + 1 && <span className="campaign-group-preview-ellipsis" aria-hidden="true">…</span>}<button type="button" className={currentPage === number ? 'active' : undefined} aria-current={currentPage === number ? 'page' : undefined} aria-label={`Page ${number}`} onClick={() => setPage(number)}>{number}</button></span>)}<button type="button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</div>
    </>}
  </section>;
}
