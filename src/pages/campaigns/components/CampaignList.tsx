import { Link } from 'react-router';
import { X } from 'lucide-react';
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
        <div className="campaign-filter-title">
          <strong>Filter campaigns</strong>
          <span>Search by name or narrow by status</span>
        </div>

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
            <option>Active</option>
            <option>Closed</option>
          </select>
          <button
            className="btn btn-secondary"
            type="button"
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
              <th>Forms</th>
              <th></th>
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
                  <strong>{campaign.name}</strong>
                </td>
                <td>
                  <span
                    className={`badge ${
                      campaign.status === 'Active'
                        ? 'badge-success'
                        : 'badge-neutral'
                    }`}
                  >
                    {campaign.status}
                  </span>
                </td>
                <td>
                  {campaign.start} - {campaign.end}
                </td>
                <td>
                  {campaign.sent === 0
                    ? '0%'
                    : `${Math.round((campaign.done / campaign.sent) * 100)}%`}
                  <progress value={campaign.done} max={campaign.sent || 1} />
                </td>
                <td>{campaign.forms.length}</td>
                <td>
                  <Link to={`/campaigns/${campaign.id}`}>
                    {'Manage campaign ->'}
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
