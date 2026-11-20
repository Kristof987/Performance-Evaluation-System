import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Printer } from 'lucide-react';
import AppLayout from '../layout/AppLayout';
import { useAppAuth } from '../../auth/AppAuth';
import { hasTeamReportsOnly } from '../../app/access';
import { ApiAccessError, type AccessTokenGetter } from '../../auth/authenticated-api';
import { fetchReportCampaigns } from './api/reports.api';
import ReportsCampaignSelector from './ReportsCampaignSelector';
import ReportsEmptyState from './components/ReportsEmptyState';
import type { ReportCampaignOption } from './types/reports.types';
import './reports.css';

/** A4 landscape with 10 mm margins, in CSS pixels. */
const PRINTABLE_WIDTH = 1040;
import LoadError from '../../components/feedback/LoadError';
import LoadingState from '../../components/feedback/LoadingState';
import { useDates } from '../../app/dates';

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

export default function ReportsLayout({ selectedCampaignId, allowQualityPreview = false, allowWrittenFeedbackPreview = false, children }: { selectedCampaignId: number | null; allowQualityPreview?: boolean; allowWrittenFeedbackPreview?: boolean; children: (state: { campaigns: ReportCampaignOption[]; getAccessToken: AccessTokenGetter | undefined; loadingCampaigns: boolean; campaignsError: string; retryCampaigns: () => void }) => ReactNode }) {
  // Charts keep the width they were drawn at, so print lays the page out at the on-screen width and scales it to the paper.
  useEffect(() => {
    const root = document.documentElement;
    const before = () => {
      const width = document.querySelector<HTMLElement>('.reports-main')?.offsetWidth;
      if (!width) return;
      root.style.setProperty('--reports-print-width', `${width}px`);
      root.style.setProperty('--reports-print-zoom', String(Math.min(1, PRINTABLE_WIDTH / width)));
    };
    const after = () => { root.style.removeProperty('--reports-print-width'); root.style.removeProperty('--reports-print-zoom'); };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); after(); };
  }, []);
  const dates = useDates();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, getAccessToken, retryAuth0 } = useAppAuth();
  const teamOnly = state.status === 'authenticated' && hasTeamReportsOnly(state.user.permissions);
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
          navigate(`/reports/campaigns/${initial.id}${teamOnly ? '/employees' : ''}`, { replace: true });
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
  }, [navigate, !!getAccessToken, reloadKey, teamOnly]);

  function campaignPath(campaignId: number) {
    if (location.pathname.includes('/ai-analysis')) return `/reports/campaigns/${campaignId}/ai-analysis`;
    if (location.pathname.includes('/answers')) return `/reports/campaigns/${campaignId}/answers`;
    if (location.pathname.includes('/groups')) return `/reports/campaigns/${campaignId}/groups`;
    if (location.pathname.includes('/roles')) return `/reports/campaigns/${campaignId}/roles`;
    if (location.pathname.includes('/employees') || teamOnly) return `/reports/campaigns/${campaignId}/employees`;
    return `/reports/campaigns/${campaignId}`;
  }

  const feedbackPreview = allowWrittenFeedbackPreview && state.status === 'authenticated' && state.user.permissions.includes('reports.read') && state.user.permissions.includes('campaigns.manage')
    && selectedCampaign && (selectedCampaign.campaign_status === 'active' || selectedCampaign.campaign_status === 'paused');
  const previewAllowed = feedbackPreview || (allowQualityPreview && state.status === 'authenticated' && state.user.permissions.includes('reports.read') && state.user.permissions.includes('campaigns.manage')
    && selectedCampaign && !selectedCampaign.is_archived && (selectedCampaign.campaign_status === 'active' || selectedCampaign.campaign_status === 'paused'));
  const unavailable = selectedCampaign && !previewAllowed && reportAvailability(selectedCampaign);
  const blocked = selectedCampaignId !== null && (loadingCampaigns || !!campaignsError || !selectedCampaign || !!unavailable);
  const heading = location.pathname === `/reports/campaigns/${selectedCampaignId}` ? 'Campaign Overview' : location.pathname.includes('/employees/') ? 'Employee Results' : location.pathname.includes('/employees') ? 'Employees' : location.pathname.includes('/ai-analysis') ? 'AI Analysis' : location.pathname.includes('/answers') ? 'All Answers' : location.pathname.includes('/questions') ? 'Question Analytics' : teamOnly ? 'Groups' : 'Groups & Roles';
  return <AppLayout activePage="reports" pageClassName="reports-page"><main className="main-content reports-main"><header className="reports-header"><div className="reports-title-block"><h1>{selectedCampaign ? heading : 'Reports'}</h1>{selectedCampaign && <p className="reports-header-context"><span title={selectedCampaign.name}>{selectedCampaign.name}</span><span className="reports-status">{selectedStatus}{selectedCampaign.is_archived ? ' · Archived' : ''}</span><small>{dates.day(selectedCampaign.start_date, undefined, 'No end date')} – {dates.day(selectedCampaign.end_date, undefined, 'No end date')}</small></p>}</div><div className="reports-header-actions">{selectedCampaign && <button type="button" className="reports-print-button" onClick={() => window.print()} title="Print this view or save it as PDF"><Printer size={14} aria-hidden="true" />Print / PDF</button>}{loadingCampaigns ? null : <ReportsCampaignSelector campaigns={campaigns} selectedCampaignId={selectedCampaignId} onSelect={(campaignId) => navigate(campaignPath(campaignId))} />}</div></header>{blocked ? loadingCampaigns ? <LoadingState variant="page" label="Loading campaigns" /> : campaignsError ? <LoadError message={campaignsError} onRetry={() => setReloadKey((value) => value + 1)} /> : <ReportsEmptyState title={unavailable ? 'Results unavailable' : 'Campaign unavailable'} message={unavailable || 'The selected campaign was deleted or is not accessible.'} /> : children({ campaigns, getAccessToken, loadingCampaigns, campaignsError, retryCampaigns: () => setReloadKey((value) => value + 1) })}</main></AppLayout>;
}
