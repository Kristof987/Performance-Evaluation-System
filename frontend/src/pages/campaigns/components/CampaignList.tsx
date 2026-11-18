import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import CampaignStatusBadge from './CampaignStatusBadge';
import { formatDate } from '../campaign.utils';
import LoadingState from '../../../components/feedback/LoadingState';
import type {
  Campaign,
  CampaignStatusFilter,
} from '../campaign.types';
type Props = {
  campaignList: Campaign[];
  filteredCampaigns: Campaign[];
  searchQuery: string;
  statusFilter: CampaignStatusFilter;
  isCampaignsLoading: boolean;
  campaignsError: string;
  setSearchQuery: (value: string) => void;
  setStatusFilter: (value: CampaignStatusFilter) => void;
};
const statuses: { value: CampaignStatusFilter; label: string }[] = [
  { value: 'All statuses', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'review', label: 'Review' },
  { value: 'closed', label: 'Closed' },
  { value: 'Archived', label: 'Archived' },
];
export default function CampaignList({
  campaignList,
  filteredCampaigns,
  searchQuery,
  statusFilter,
  isCampaignsLoading,
  campaignsError,
  setSearchQuery,
  setStatusFilter,
}: Props) {
  const [statusOpen, setStatusOpen] = useState(false);
  const statusDropdown = useRef<HTMLDivElement>(null);
  const statusTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!statusOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!statusDropdown.current?.contains(event.target as Node)) setStatusOpen(false);
    }
    function onFocusIn(event: FocusEvent) {
      if (!statusDropdown.current?.contains(event.target as Node)) setStatusOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); setStatusOpen(false); statusTrigger.current?.focus(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const options = Array.from(statusDropdown.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      if (!options.length) return;
      event.preventDefault();
      const current = options.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : event.key === 'ArrowDown' ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
      options[next].focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('keydown', onKeyDown); };
  }, [statusOpen]);

  return (
    <>
      <div className="campaign-filter-bar" role="search" aria-label="Filter campaigns">
          <div className="campaign-search-field">
            <Search className="campaign-search-icon" size={17} aria-hidden="true" />
            <input
              aria-label="Search campaigns"
              placeholder="Search campaigns..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery !== '' && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
              >
                <X size={15} strokeWidth={2.4} />
              </button>
            )}
          </div>
          <div className="campaign-status-dropdown" ref={statusDropdown}>
            <button ref={statusTrigger} className="campaign-status-trigger" type="button" aria-label={`Filter by status: ${statuses.find((status) => status.value === statusFilter)?.label ?? 'All statuses'}`} aria-haspopup="menu" aria-expanded={statusOpen} aria-controls={statusOpen ? 'campaign-status-menu' : undefined} onClick={() => setStatusOpen((open) => !open)} onKeyDown={(event) => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && !statusOpen) { event.preventDefault(); setStatusOpen(true); requestAnimationFrame(() => { const options = statusDropdown.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'); options?.[event.key === 'ArrowUp' ? options.length - 1 : 0]?.focus(); }); } }}><SlidersHorizontal size={16} aria-hidden="true" /><span>{statuses.find((status) => status.value === statusFilter)?.label ?? 'All statuses'}</span><ChevronDown size={15} aria-hidden="true" /></button>
            {statusOpen && <div className="campaign-status-menu" id="campaign-status-menu" role="menu" aria-label="Campaign status">{statuses.map((status) => <button key={status.value} type="button" role="menuitemradio" aria-checked={statusFilter === status.value} className={statusFilter === status.value ? 'selected' : ''} onClick={() => { setStatusFilter(status.value); setStatusOpen(false); statusTrigger.current?.focus(); }}>{status.label}{statusFilter === status.value && <Check size={15} aria-hidden="true" />}</button>)}</div>}
          </div>
          {(searchQuery !== '' || statusFilter !== 'All statuses') && <button className="campaign-clear-filters" type="button" onClick={() => { setSearchQuery(''); setStatusFilter('All statuses'); }}>Clear filters</button>}
      </div>

      <div className="campaign-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Period</th>
              <th>Completion</th>
              <th>Evaluations</th>
              <th><span className="campaign-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {isCampaignsLoading && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>
                  <LoadingState variant="section" label="Loading campaigns" />
                </td>
              </tr>
            )}
            {campaignsError !== '' && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>
                  {campaignsError}
                </td>
              </tr>
            )}
            {!isCampaignsLoading &&
              campaignsError === '' &&
              campaignList.length === 0 && (
                <tr>
                  <td className="campaign-state-cell" colSpan={6}>
                     No campaigns have been created yet.
                  </td>
                </tr>
              )}
            {!isCampaignsLoading &&
              campaignsError === '' &&
              campaignList.length > 0 &&
              filteredCampaigns.length === 0 && (
                <tr>
                  <td className="campaign-state-cell" colSpan={6}>
                    No campaigns match the current filters.
                  </td>
                </tr>
              )}
            {filteredCampaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <Link className="campaign-name-link" to={`/campaigns/${campaign.id}`}>{campaign.name}</Link>
                </td>
                <td>
                  <CampaignStatusBadge status={campaign.status} />
                  {campaign.isArchived && <span className="campaign-archived-label"> Archived</span>}
                  {campaign.status === 'scheduled' && (
                    <span className={`campaign-activation-note${campaign.activationError ? ' campaign-activation-failed' : ''}`}>
                      {campaign.activationError ? 'Activation failed' : 'Activation pending'}
                    </span>
                  )}
                  {campaign.status === 'active' && <span className="campaign-activation-note">Activation succeeded</span>}
                  {campaign.status === 'active' && campaign.lifecycleError && (
                    <span className="campaign-activation-note campaign-activation-failed">Review transition failed</span>
                  )}
                  {campaign.status === 'scheduled' && campaign.activationError && (
                    <span className="campaign-activation-list-error">{campaign.activationError}</span>
                  )}
                  {campaign.status === 'active' && campaign.lifecycleError && (
                    <span className="campaign-activation-list-error">{campaign.lifecycleError}</span>
                  )}
                  {campaign.lastTransitionAt && (
                    <span className="campaign-activation-note">Last transition: {formatDate(campaign.lastTransitionAt)} (Budapest)</span>
                  )}
                </td>
                <td>
                  <span className="campaign-period-label">Start: {campaign.start}</span>
                  <span className="campaign-period-label">End: {campaign.end}</span>
                </td>
                <td>
                  {campaign.sent === 0
                    ? '0%'
                    : `${Math.round((campaign.done / campaign.sent) * 100)}%`}
                  <progress aria-label={`${campaign.name} completion`} value={campaign.done} max={campaign.sent || 1} />
                </td>
                <td>{campaign.issuedFormsCount}</td>
                <td>
                  <Link to={`/campaigns/${campaign.id}`}>
                    {'View details ->'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
