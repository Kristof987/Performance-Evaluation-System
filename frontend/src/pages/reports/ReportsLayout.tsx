import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { useAppAuth } from '../../auth/AppAuth';
import { ApiAccessError, type AccessTokenGetter } from '../../auth/authenticated-api';
import { fetchReportCampaigns } from './api/reports.api';
import ReportsCampaignSelector from './ReportsCampaignSelector';
import ReportsEmptyState from './components/ReportsEmptyState';
import type { ReportCampaignOption } from './types/reports.types';
import './reports.css';

function formatDate(value: string | null) {
  if (value === null) return 'No end date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

export function reportAvailability(campaign: ReportCampaignOption) {
  if (campaign.campaign_status === 'review' || campaign.campaign_status === 'closed') return null;
  if (campaign.is_archived) return 'This paused campaign is archived. Its results are unavailable.';
  switch (campaign.campaign_status) {
    case 'draft': return 'This campaign is still a draft. Reports become available when it reaches Review.';
    case 'scheduled': return 'This campaign is scheduled. Reports become available when it reaches Review.';
    case 'active': return 'This campaign is active. Results remain unavailable until it reaches Review; operational completion is available from Campaigns.';
    case 'paused': return 'This campaign is paused. Results are unavailable until it resumes and reaches Review.';
    default: return 'Results are not available for this campaign.';
  }
}

export default function ReportsLayout({ selectedCampaignId, children }: { selectedCampaignId: number | null; children: (state: { campaigns: ReportCampaignOption[]; getAccessToken: AccessTokenGetter | undefined; loadingCampaigns: boolean; campaignsError: string; retryCampaigns: () => void }) => ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { getAccessToken, retryAuth0 } = useAppAuth();
  const accessTokenRef = useRef(getAccessToken);
  accessTokenRef.current = getAccessToken;
  const [campaigns, setCampaigns] = useState<ReportCampaignOption[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignsError, setCampaignsError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedStatus = selectedCampaign?.campaign_status ?? null;

  useEffect(() => {
    const tokenGetter = accessTokenRef.current;
    if (!tokenGetter) {
      setLoadingCampaigns(false);
      setCampaignsError('Auth0 sign-in is required to view reports.');
      return undefined;
    }
    const controller = new AbortController();
    setLoadingCampaigns(true);
    fetchReportCampaigns(tokenGetter, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setCampaigns(items);
        setCampaignsError('');
        if (selectedCampaignId === null && items.length > 0) {
          const initial = items.find((campaign) => reportAvailability(campaign) === null) ?? items[0];
          navigate(`/reports/campaigns/${initial.id}`, { replace: true });
        }
      })
      .catch((cause) => {
        if (cause instanceof ApiAccessError && !controller.signal.aborted) retryAuth0();
        if (!controller.signal.aborted) setCampaignsError(cause instanceof Error ? cause.message : 'Campaigns could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCampaigns(false);
      });
    return () => controller.abort();
  }, [navigate, !!getAccessToken, reloadKey, selectedCampaignId]);

  function campaignPath(campaignId: number) {
    if (location.pathname.includes('/groups')) return `/reports/campaigns/${campaignId}/groups`;
    if (location.pathname.includes('/roles')) return `/reports/campaigns/${campaignId}/roles`;
    if (location.pathname.includes('/employees')) return `/reports/campaigns/${campaignId}/employees`;
    if (location.pathname.includes('/questions')) return `/reports/campaigns/${campaignId}/questions`;
    return `/reports/campaigns/${campaignId}`;
  }

   const unavailable = selectedCampaign && reportAvailability(selectedCampaign);
   const blocked = selectedCampaignId !== null && (loadingCampaigns || !!campaignsError || !selectedCampaign || !!unavailable);
   return <AppLayout activePage="reports" pageClassName="reports-page"><main className="main-content reports-main"><header className="reports-header"><div className="reports-title-block"><h1>Reports</h1><p>Analyze performance reviews and team feedback.</p>{selectedCampaign && <p className="reports-campaign-meta">{selectedCampaign.name} · {formatDate(selectedCampaign.start_date)} - {formatDate(selectedCampaign.end_date)} · {selectedStatus}{selectedCampaign.is_archived ? ' · Archived' : ''}</p>}</div><div className="reports-header-actions"><ReportsCampaignSelector campaigns={campaigns} selectedCampaignId={selectedCampaignId} onSelect={(campaignId) => navigate(campaignPath(campaignId))} /></div></header><nav className="reports-tabs" aria-label="Reports sections">{selectedCampaignId === null ? <span className="active">Overview</span> : <NavLink end to={`/reports/campaigns/${selectedCampaignId}`}>Overview</NavLink>} {selectedCampaignId === null ? <span>Groups & Roles</span> : <NavLink to={`/reports/campaigns/${selectedCampaignId}/groups`}>Groups & Roles</NavLink>}{selectedCampaignId === null ? <span>Employees</span> : <NavLink to={`/reports/campaigns/${selectedCampaignId}/employees`}>Employees</NavLink>}{selectedCampaignId === null ? <span>Question Analytics</span> : <NavLink to={`/reports/campaigns/${selectedCampaignId}/questions`}>Question Analytics</NavLink>}</nav>{blocked ? loadingCampaigns ? <div className="reports-state">Loading campaigns...</div> : campaignsError ? <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div> : <ReportsEmptyState title={unavailable ? 'Results unavailable' : 'Campaign unavailable'} message={unavailable || 'The selected campaign was deleted or is not accessible.'} /> : children({ campaigns, getAccessToken, loadingCampaigns, campaignsError, retryCampaigns: () => setReloadKey((value) => value + 1) })}</main></AppLayout>;
}
