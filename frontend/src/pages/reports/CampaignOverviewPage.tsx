import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { fetchCampaignReportOverview } from './api/reports.api';
import SectionScoresChart from './components/SectionScoresChart';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsKpiPanel from './components/ReportsKpiPanel';
import ReportsLayout from './ReportsLayout';
import type { CampaignReportOverview } from './types/reports.types';
import type { AccessTokenGetter } from '../../auth/authenticated-api';

export function ReportsIndexPage() {
  return <ReportsLayout selectedCampaignId={null}>{({ loadingCampaigns, campaignsError, campaigns, retryCampaigns }) => {
    if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
    if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
    if (campaigns.length === 0) return <ReportsEmptyState title="No campaigns available." message="Create a campaign before reports can be shown." />;
    return <div className="reports-state">Opening selected campaign...</div>;
  }}</ReportsLayout>;
}

export default function CampaignOverviewPage() {
  const { campaignId } = useParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;

  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{(layoutState) => <OverviewContent selectedCampaignId={selectedCampaignId} validCampaignId={validCampaignId} {...layoutState} />}</ReportsLayout>;
}

function OverviewContent({
  selectedCampaignId,
  validCampaignId,
  getAccessToken,
  loadingCampaigns,
  campaignsError,
  campaigns,
  retryCampaigns,
}: {
  selectedCampaignId: number;
  validCampaignId: boolean;
  campaigns: Array<{ id: number }>;
  getAccessToken: AccessTokenGetter | undefined;
  loadingCampaigns: boolean;
  campaignsError: string;
  retryCampaigns: () => void;
}) {
  const [data, setData] = useState<CampaignReportOverview | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!validCampaignId || !getAccessToken) return undefined;
    const controller = new AbortController();
    setData(null);
    setError('');
    fetchCampaignReportOverview(getAccessToken, selectedCampaignId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Campaign report could not be loaded.');
      });
    return () => controller.abort();
  }, [getAccessToken, reloadKey, selectedCampaignId, validCampaignId]);

  if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
  if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
  if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
  if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
  if (error) return <div className="reports-state reports-error" role="alert"><span>{error}</span><button className="btn btn-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>;
  if (data === null) return <div className="reports-state">Loading campaign analytics...</div>;

  const noAssignments = data.kpis.total_evaluations === 0;
  const noCompleted = data.kpis.total_evaluations > 0 && data.kpis.completed_evaluations === 0;

  return <div className="reports-overview"><ReportsKpiPanel kpis={data.kpis} />{noAssignments && <ReportsEmptyState title="No evaluations have been assigned to this campaign yet." message="Analytics will appear after evaluation assignments are generated." />}{noCompleted && <ReportsEmptyState title="No completed evaluations yet." message="Reports use submitted evaluations only; drafts and not-started assignments are excluded from results." />}<div className="reports-chart-grid reports-chart-grid-single"><SectionScoresChart sections={data.sections} /></div></div>;
}
