import AppLayout from '../layout/AppLayout';
import { getSidebarUser, formatUserName } from '../layout/sidebar-user';
import './hr-home.css';
import { useNavigate } from 'react-router';

import DashboardTopbar from './components/DashboardTopbar';
import CampaignBar from './components/CampaignBar';
import MetricsGrid from './components/MetricsGrid';
import ParticipantsSection from './components/ParticipantsSection';
import NextActions from './components/NextActions';
import UpcomingDeadlines from './components/UpcomingDeadlines';
import { useHrDashboard } from './hooks/useHrDashboard';

function HrHome() {
  const navigate = useNavigate();
  const {
    campaigns,
    selectedCampaign,
    metrics,
    participants,
    upcomingDeadlines,
    isLoading,
    error,
    selectCampaign,
  } = useHrDashboard();

  const sidebarUser = getSidebarUser();
  const sidebarUserName =
    sidebarUser === null ? 'User' : formatUserName(sidebarUser.username);

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

  return (
    <AppLayout activePage="hr-home" pageClassName="hr-home-page">
      <div className="main-content">
        <DashboardTopbar userName={sidebarUserName} />

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
          onViewCampaignDetails={selectedCampaignDetailsHandler}
        />

        {!isLoading && metrics !== null && campaigns.length > 0 && (
          <>
            <MetricsGrid metrics={metrics} campaigns={campaigns} />

            <div className="workspace">
              <ParticipantsSection participants={participants} />
              <NextActions
                metrics={metrics}
                campaignName={selectedCampaign?.name}
                onOpenCampaign={selectedCampaignDetailsHandler}
              />
            </div>
          </>
        )}

        <UpcomingDeadlines
          deadlines={upcomingDeadlines}
          onOpenCampaign={campaignDetailsHandler}
        />
      </div>
    </AppLayout>
  );
}

export default HrHome;
