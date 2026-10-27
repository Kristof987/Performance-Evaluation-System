import { Link, useParams } from 'react-router';
import EmployeeAIAnalysisPanel from './components/EmployeeAIAnalysisPanel';
import ReportsLayout from './ReportsLayout';

export default function AIAnalysisPage() {
  const { campaignId } = useParams();
  const id = Number(campaignId);
  return <ReportsLayout selectedCampaignId={Number.isSafeInteger(id) && id > 0 ? id : null}>{({ getAccessToken }) => <div className="reports-overview"><div className="reports-crumbs"><Link to={`/reports/campaigns/${id}`}>Overview</Link><span>/</span><strong>AI Analysis</strong></div><header className="reports-detail-heading"><h2>AI Analysis</h2><p>Campaign-wide analysis and review. Employee analyses are accessible from each employee report.</p></header>{getAccessToken && <EmployeeAIAnalysisPanel scope={{ type: 'campaign', campaignId: id }} getAccessToken={getAccessToken} />}</div>}</ReportsLayout>;
}
