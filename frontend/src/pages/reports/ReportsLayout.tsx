import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router';
import AppLayout from '../layout/AppLayout';
import { getSidebarUser } from '../layout/sidebar-user';
import { fetchReportCampaigns } from './api/reports.api';
import ReportsCampaignSelector from './ReportsCampaignSelector';
import type { ReportCampaignOption } from './types/reports.types';
import './reports.css';

function formatDate(value: string | null) {
  if (value === null) return 'No end date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

export default function ReportsLayout({ selectedCampaignId, children }: { selectedCampaignId: number | null; children: (state: { campaigns: ReportCampaignOption[]; requesterUserId: number | null; loadingCampaigns: boolean; campaignsError: string; retryCampaigns: () => void }) => ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const requesterUserId = getSidebarUser()?.id ?? null;
  const [campaigns, setCampaigns] = useState<ReportCampaignOption[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);
  const [campaignsError, setCampaignsError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const selectedStatus = selectedCampaign?.lifecycle_status ?? null;

  useEffect(() => {
    if (requesterUserId === null) {
      setLoadingCampaigns(false);
      setCampaignsError('Sign in is required to view reports.');
      return undefined;
    }
    const controller = new AbortController();
    setLoadingCampaigns(true);
    fetchReportCampaigns(requesterUserId, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        setCampaigns(items);
        setCampaignsError('');
        if (selectedCampaignId === null && items.length > 0) navigate(`/reports/campaigns/${items[0].id}`, { replace: true });
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setCampaignsError(cause instanceof Error ? cause.message : 'Campaigns could not be loaded.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCampaigns(false);
      });
    return () => controller.abort();
  }, [navigate, requesterUserId, reloadKey, selectedCampaignId]);

  function campaignPath(campaignId: number) {
    if (location.pathname.includes('/groups')) return `/reports/campaigns/${campaignId}/groups`;
    if (location.pathname.includes('/roles')) return `/reports/campaigns/${campaignId}/roles`;
    if (location.pathname.includes('/employees')) return `/reports/campaigns/${campaignId}/employees`;
    return `/reports/campaigns/${campaignId}`;
  }

  return <AppLayout activePage="reports" pageClassName="reports-page"><main className="main-content reports-main"><header className="reports-header"><div className="reports-title-block"><h1>Reports</h1><p>Analyze performance reviews and team feedback.</p>{selectedCampaign && <p className="reports-campaign-meta">{selectedCampaign.name} · {formatDate(selectedCampaign.start_date)} - {formatDate(selectedCampaign.end_date)} · {selectedStatus}</p>}</div><div className="reports-header-actions"><ReportsCampaignSelector campaigns={campaigns} selectedCampaignId={selectedCampaignId} onSelect={(campaignId) => navigate(campaignPath(campaignId))} /></div></header><nav className="reports-tabs" aria-label="Reports sections">{selectedCampaignId === null ? <span className="active">Overview</span> : <NavLink end to={`/reports/campaigns/${selectedCampaignId}`}>Overview</NavLink>} {selectedCampaignId === null ? <span>Groups & Roles</span> : <NavLink to={`/reports/campaigns/${selectedCampaignId}/groups`}>Groups & Roles</NavLink>}{selectedCampaignId === null ? <span>Employees</span> : <NavLink to={`/reports/campaigns/${selectedCampaignId}/employees`}>Employees</NavLink>}</nav>{children({ campaigns, requesterUserId, loadingCampaigns, campaignsError, retryCampaigns: () => setReloadKey((value) => value + 1) })}</main></AppLayout>;
}
