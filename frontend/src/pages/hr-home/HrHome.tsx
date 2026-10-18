import AppLayout from '../layout/AppLayout';
import { getSidebarUser, getUserDisplayName } from '../layout/sidebar-user';
import { useAppAuth } from '../../auth/AppAuth';
import './hr-home.css';
import { useNavigate } from 'react-router';

import DashboardTopbar from './components/DashboardTopbar';
import CampaignBar from './components/CampaignBar';
import MetricsGrid from './components/MetricsGrid';
import ParticipantsSection from './components/ParticipantsSection';
import NextActions from './components/NextActions';
import UpcomingDeadlines from './components/UpcomingDeadlines';
import YourEvaluationsCard from './components/YourEvaluationsCard';
import { useHrDashboard } from './hooks/useHrDashboard';

function HrHome() {
  const navigate = useNavigate();
  const { state } = useAppAuth();
  const auth0User = state.status === 'authenticated' && state.mode === 'auth0' ? state.user : null;
  const canManageCampaigns = auth0User?.permissions.includes('campaigns.manage') ?? false;
  const canReadAssigned = auth0User?.permissions.includes('evaluations.read_assigned') ?? false;
  const canReadReports = auth0User?.permissions.includes('reports.read') ?? false;
  const {
    campaigns,
    currentDate,
    selectedCampaign,
    metrics,
    participants,
    upcomingDeadlines,
    isLoading,
    error,
    selectCampaign,
  } = useHrDashboard();

  const sidebarUser = getSidebarUser();
  const sidebarUserName = auth0User?.employee.full_name ?? (
    sidebarUser === null ? 'User' : getUserDisplayName(sidebarUser));

  const campaignsButtonHandler = () => {
    navigate('/campaigns');
  };

  const selectedCampaignDetailsHandler = () => {
    if (selectedCampaign === null) {
      return;
    }

    navigate(`/campaigns/${selectedCampaign.id}`);
  };

  const campaignDetailsHandler = (campaignId: number) => {
    navigate(`/campaigns/${campaignId}`);
  };

  const completionStatusHandler = () => {
    if (selectedCampaign === null) return;
    navigate(`/campaigns/${selectedCampaign.id}/completion`);
  };

  return (
    <AppLayout activePage="hr-home" pageClassName="hr-home-page">
      <div className="main-content">
        <DashboardTopbar userName={sidebarUserName} currentDate={currentDate} />

        <div className="section-header">
          <div className="overview-title">Campaign overview</div>
        </div>

        <CampaignBar
          isLoading={isLoading}
          error={error}
          campaigns={campaigns}
          selectedCampaign={selectedCampaign}
          onSelectCampaign={selectCampaign}
          onCreateCampaign={campaignsButtonHandler}
          canManageCampaigns={canManageCampaigns}
          onViewCampaignDetails={selectedCampaignDetailsHandler}
        />

        {!isLoading && metrics !== null && campaigns.length > 0 && (
          <>
            <MetricsGrid metrics={metrics} campaigns={campaigns} />
            {canReadAssigned && <YourEvaluationsCard />}

            <div className="workspace">
              <ParticipantsSection participants={participants} onViewCompletionStatus={completionStatusHandler} />
              <NextActions
                metrics={metrics}
                campaignName={selectedCampaign?.name}
                onOpenCampaign={selectedCampaignDetailsHandler}
                onOpenResults={() => selectedCampaign && navigate(`/reports/campaigns/${selectedCampaign.id}`)}
                includeResults={canReadReports}
              />
            </div>
          </>
        )}

        <UpcomingDeadlines
          deadlines={upcomingDeadlines}
          currentDate={currentDate}
          onOpenCampaign={campaignDetailsHandler}
        />
      </div>
    </AppLayout>
  );
}

export default HrHome;
