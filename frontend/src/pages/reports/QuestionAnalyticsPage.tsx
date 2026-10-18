import { Link, useParams, useSearchParams } from 'react-router';
import QuestionAnalytics from './components/QuestionAnalytics';
import ReportsEmptyState from './components/ReportsEmptyState';
import ReportsLayout from './ReportsLayout';
import type { RolePerspective } from './types/reports.types';

function positiveId(value: string | null) {
  const number = Number(value);
  return value !== null && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

export default function QuestionAnalyticsPage() {
  const { campaignId } = useParams();
  const [searchParams] = useSearchParams();
  const selectedCampaignId = Number(campaignId);
  const validCampaignId = Number.isSafeInteger(selectedCampaignId) && selectedCampaignId > 0;
  const employeeId = positiveId(searchParams.get('employee_id'));
  const groupId = positiveId(searchParams.get('group_id'));
  const roleId = positiveId(searchParams.get('role_id'));
  const scope = employeeId !== undefined ? { employee_id: employeeId }
    : groupId !== undefined ? { group_id: groupId }
      : roleId !== undefined ? { role_id: roleId, perspective: (searchParams.get('perspective') === 'evaluator' ? 'evaluator' : 'evaluatee') as RolePerspective }
        : {};
  const scoped = Object.keys(scope).length > 0;

  return <ReportsLayout selectedCampaignId={validCampaignId ? selectedCampaignId : null}>{({ campaigns, getAccessToken, loadingCampaigns, campaignsError, retryCampaigns }) => {
    if (!validCampaignId) return <ReportsEmptyState title="Campaign not found." message="Choose a valid campaign from the selector." />;
    if (loadingCampaigns) return <div className="reports-state">Loading campaigns...</div>;
    if (campaignsError) return <div className="reports-state reports-error" role="alert"><span>{campaignsError}</span><button className="btn btn-secondary" type="button" onClick={retryCampaigns}>Retry</button></div>;
    if (!campaigns.some((campaign) => campaign.id === selectedCampaignId)) return <ReportsEmptyState title="Campaign unavailable." message="The selected campaign was deleted or is not accessible." />;
    return <div className="reports-overview">{scoped && <div className="reports-question-scope"><span>{employeeId !== undefined ? 'Employee' : groupId !== undefined ? 'Group' : 'Company role'} question responses</span><Link to={`/reports/campaigns/${selectedCampaignId}/questions`}>View entire campaign</Link></div>}<QuestionAnalytics campaignId={selectedCampaignId} getAccessToken={getAccessToken} scope={scope} /></div>;
  }}</ReportsLayout>;
}
