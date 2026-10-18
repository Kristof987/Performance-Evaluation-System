import { Link } from 'react-router';
import { X } from 'lucide-react';
import CampaignStatusBadge from './CampaignStatusBadge';
import { formatDate } from '../campaign.utils';
import type {
  Campaign,
  CampaignStatus,
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
  return (
    <>
      <div className="campaign-filter-bar">
        <div className="campaign-filters">
          <div className="campaign-search-field">
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
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as 'All statuses' | CampaignStatus,
              )
            }
          >
            <option>All statuses</option>
             <option value="draft">Draft</option>
             <option value="scheduled">Scheduled</option>
             <option value="active">Active</option>
             <option value="paused">Paused</option>
             <option value="review">Review</option>
             <option value="closed">Closed</option>
          </select>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={searchQuery === '' && statusFilter === 'All statuses'}
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('All statuses');
            }}
          >
            Reset
          </button>
        </div>
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
                  Loading campaigns...
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
