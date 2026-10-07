import AppLayout from '../layout/AppLayout';
import {
  getSidebarUser,
  formatUserName,
  getUserInitials,
} from '../layout/sidebar-user';
import './hr-home.css';
import {
  ChevronDown,
  Folder,
  BellRing,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { API_BASE_URL } from '../../config';

type Campaign = {
  id: number;
  name: string;
  is_active: boolean;
};

type DashboardMetrics = {
  assignment_count: number;
  submitted_count: number;
  completion_rate: number;
  awaiting_submission_count: number;
  not_started_count: number;
  in_progress_count: number;
  overdue_count: number;
  overdue_forms_count: number;
  upcoming_reviews_count: number;
  next_review_date: string | null;
};

type DashboardForm = {
  form_id: number;
  name: string;
  audience: string;
  submitted_count: number;
  assignment_count: number;
  due_date: string | null;
  overdue_count: number;
};

type DashboardParticipant = {
  user_id: number;
  name: string;
  email: string;
  profile_image_url: string | null;
  role_name: string;
  groups: string[];
  evaluations_left: number;
};

type DashboardUpcomingDeadline = {
  campaign_id: number;
  name: string;
  deadline_type: 'Starts' | 'Ends';
  date: string;
};

type DashboardResponse = {
  campaigns: Campaign[];
  selected_campaign_id: number | null;
  metrics: DashboardMetrics | null;
  forms: DashboardForm[];
  participants: DashboardParticipant[];
  upcoming_deadlines: DashboardUpcomingDeadline[];
};

function HrHome() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );
  const [dashboardMetrics, setDashboardMetrics] =
    useState<DashboardMetrics | null>(null);
  const [dashboardParticipants, setDashboardParticipants] = useState<
    DashboardParticipant[]
  >([]);
  const [upcomingDeadlines, setUpcomingDeadlines] = useState<
    DashboardUpcomingDeadline[]
  >([]);
  const [isCampaignListOpen, setIsCampaignListOpen] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');

  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;
  const sidebarUser = getSidebarUser();
  const sidebarUserName =
    sidebarUser === null ? 'User' : formatUserName(sidebarUser.username);

  useEffect(() => {
    fetchDashboard();
  }, []);

  async function fetchDashboard(campaignId?: number) {
    setIsDashboardLoading(true);

    try {
      const searchParams =
        campaignId === undefined ? '' : `?campaign_id=${campaignId}`;
      const response = await fetch(`${API_BASE_URL}/dashboard${searchParams}`);

      if (!response.ok) {
        throw new Error(
          `Dashboard request failed with status ${response.status}`,
        );
      }

      const dashboard = (await response.json()) as DashboardResponse;
      setCampaigns(dashboard.campaigns);
      setSelectedCampaignId(dashboard.selected_campaign_id);
      setDashboardMetrics(dashboard.metrics);
      setDashboardParticipants(dashboard.participants ?? []);
      setUpcomingDeadlines(dashboard.upcoming_deadlines ?? []);
      setDashboardError('');
    } catch (error) {
      console.log('Dashboard could not be loaded', error);
      setDashboardError('Dashboard could not be loaded.');
    } finally {
      setIsDashboardLoading(false);
    }
  }

  const campaignsButtonHandler = () => {
    navigate('/campaigns');
  };

  const selectedCampaignDetailsHandler = () => {
    if (selectedCampaign === null) {
      return;
    }

    navigate(`/campaigns/${selectedCampaign.id}`);
  };

  function getTimeOfDay() {
    const currentHour = new Date().getHours();

    if (currentHour >= 5 && currentHour < 12) return 'morning';
    if (currentHour >= 12 && currentHour < 18) return 'afternoon';
    return 'evening';
  }

  function getFullDate() {
    const currentDate = new Date();
    const currentDay = currentDate.getDate().toString();
    const currentMonth = currentDate.toLocaleDateString('en-US', {
      month: 'long',
    });
    const currentYear = currentDate.getFullYear().toString();
    const currentDayString = currentDate.toLocaleDateString('en-US', {
      weekday: 'long',
    }); //In case of another language, it may not start with capital letter!

    return (
      currentDayString +
      ', ' +
      currentDay +
      ' ' +
      currentMonth +
      ' ' +
      currentYear
    );
  }

  function formatShortDate(value: string | null) {
    if (value === null) {
      return 'No date';
    }

    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(`${value}T00:00:00`));
  }

  return (
    <AppLayout activePage="hr-home" pageClassName="hr-home-page">
      <div className="main-content">
        <div className="topbar">
          <div className="greeting">
            <div className="greeting-title">
              Good {getTimeOfDay()}, {sidebarUserName}
            </div>
            <div className="greeting-date">{getFullDate()}</div>
          </div>
          <aside className="dashboard-tip" aria-label="Dashboard tip">
            <strong>Did you know?</strong>
            <span>
              Campaigns with clear role-based review rules are easier to track and usually need fewer manual follow-ups.
            </span>
          </aside>
        </div>

        <div className="section-header">
          <div className="overview-title">Campaign overview</div>
        </div>

        {isDashboardLoading ? (
          <div className="campaign-bar">
            <div className="campaign-selector">
              <Folder size={16} color="#4553C4" />
              <div className="campaign-name">Loading dashboard...</div>
            </div>
          </div>
        ) : dashboardError !== '' ? (
          <div className="card empty-campaign-card">
            <div>
              <div className="empty-campaign-title">
                Dashboard is unavailable
              </div>
              <div className="empty-campaign-text">
                Refresh the page after the backend connection is restored.
              </div>
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="card empty-campaign-card">
            <div>
              <div className="empty-campaign-title">No campaigns yet</div>
              <div className="empty-campaign-text">
                Create your first campaign to start collecting performance
                feedback.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary empty-campaign-button"
              onClick={campaignsButtonHandler}
            >
              Create campaign
            </button>
          </div>
        ) : (
          <div className="campaign-bar">
            <div className="campaign-selector-wrap">
              <button
                type="button"
                className="campaign-selector"
                onClick={() => setIsCampaignListOpen(!isCampaignListOpen)}
              >
                <Folder size={16} color="#4553C4" />
                <div className="campaign-name">{selectedCampaign?.name}</div>
                <div className="badge badge-success campaign-status">
                  {selectedCampaign?.is_active ? 'Active' : 'Closed'}
                </div>
                <ChevronDown size={14} color="#5A6079" />
              </button>
              {isCampaignListOpen && (
                <div className="campaign-dropdown">
                  {campaigns.map((campaign) => (
                    <button
                      key={campaign.id}
                      type="button"
                      className="campaign-dropdown-item"
                      onClick={() => {
                        fetchDashboard(campaign.id);
                        setIsCampaignListOpen(false);
                      }}
                    >
                      <span>{campaign.name}</span>
                      <span>{campaign.is_active ? 'Active' : 'Closed'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="campaign-details-link"
              onClick={selectedCampaignDetailsHandler}
            >
              View campaign details →
            </button>
          </div>
        )}

        {!isDashboardLoading &&
          dashboardMetrics !== null &&
          campaigns.length > 0 && (
            <>
              <div className="metrics">
                <div className="card metric-card">
                  <div className="metric-label">Completion rate</div>
                  <div className="metric-value accent">
                    {dashboardMetrics.completion_rate}%
                  </div>
                  <div className="metric-context">
                    {dashboardMetrics.submitted_count} of{' '}
                    {dashboardMetrics.assignment_count} assignments submitted
                  </div>
                </div>
                <div className="card metric-card">
                  <div className="metric-label">Awaiting submission</div>
                  <div className="metric-value">
                    {dashboardMetrics.awaiting_submission_count}
                  </div>
                  <div className="metric-context">
                    {dashboardMetrics.not_started_count} not started ·{' '}
                    {dashboardMetrics.in_progress_count} in progress
                  </div>
                </div>
                <div className="card metric-card">
                  <div className="metric-label">Overdue</div>
                  <div className="metric-value danger">
                    {dashboardMetrics.overdue_count}
                  </div>
                  <div className="metric-context">
                    Across {dashboardMetrics.overdue_forms_count} forms
                  </div>
                </div>
                <div className="card metric-card">
                  <div className="metric-label">Upcoming reviews</div>
                  <div className="metric-value">
                    {dashboardMetrics.upcoming_reviews_count}
                  </div>
                  <div className="metric-context">
                    Next review ·{' '}
                    {formatShortDate(dashboardMetrics.next_review_date)}
                  </div>
                </div>
              </div>

              <div className="workspace">
                <div className="forms-section">
                  <div className="section-header">
                    <div className="section-title">Participants</div>
                    <button className="campaign-details-link" type="button">
                      View full completion status →
                    </button>
                  </div>

                  <div className="card participants-table">
                    <div className="participants-table-header">
                      <div className="participants-table-heading col-participant">Employee</div>
                      <div className="participants-table-heading col-role">Role</div>
                      <div className="participants-table-heading col-groups">Groups</div>
                      <div className="participants-table-heading col-evaluations-left">
                        Evaluations left
                      </div>
                    </div>

                    {dashboardParticipants.length === 0 && (
                      <div className="forms-empty-state">
                        No participants are assigned to this campaign.
                      </div>
                    )}

                    {dashboardParticipants.map((participant) => (
                      <div className="participant-row" key={participant.user_id}>
                        <div className="user-avatar participant-avatar">
                          {participant.profile_image_url ? (
                            <img
                              src={participant.profile_image_url}
                              alt={participant.name}
                            />
                          ) : (
                            <div className="user-initials">
                              {getUserInitials(participant.name)}
                            </div>
                          )}
                        </div>
                        <div className="participant-info">
                          <div className="participant-name">{participant.name}</div>
                          <div className="participant-email">{participant.email}</div>
                        </div>
                        <div className="participant-role">{participant.role_name}</div>
                        <div className="participant-groups">
                          {participant.groups.join(', ')}
                        </div>
                        <div className="participant-evaluations-left">
                          {participant.evaluations_left}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="next-actions">
                  <div className="section-title">Next Actions</div>

                  {dashboardMetrics.overdue_count > 0 && (
                    <div className="card overdue-alert">
                      <div className="overdue-alert-title">
                        {dashboardMetrics.overdue_count} submissions are overdue
                      </div>
                      <div className="overdue-alert-text">
                        Follow up with reviewers who missed their deadline.
                      </div>
                      <div className="btn btn-secondary reminder-button">
                        <BellRing size={14} />
                        <span>Send reminders</span>
                      </div>
                    </div>
                  )}

                  <div className="card publish-card">
                    <div className="publish-card-title">
                      {dashboardMetrics.completion_rate === 100 &&
                      dashboardMetrics.assignment_count > 0
                        ? 'Results ready to publish'
                        : 'Results in progress'}
                    </div>
                    <div className="publish-card-context">
                      {selectedCampaign?.name} ·{' '}
                      {dashboardMetrics.submitted_count} submitted
                    </div>
                    <div className="publish-card-link">Review results →</div>
                  </div>
                </div>
              </div>
            </>
          )}

        <div className="upcoming-section">
          <div className="section-header">
            <div className="section-title">Upcoming deadlines</div>
          </div>
          <div className="upcoming-list">
            {upcomingDeadlines.length === 0 && (
              <div className="upcoming-item">
                <div className="upcoming-name">No upcoming deadlines</div>
                <div className="upcoming-meta">
                  Campaign start and end dates will show here.
                </div>
              </div>
            )}
            {upcomingDeadlines.map((deadline) => (
              <div
                className="upcoming-item"
                key={`${deadline.campaign_id}:${deadline.deadline_type}`}
              >
                <div className="upcoming-date">
                  {formatShortDate(deadline.date)}
                </div>
                <div className="upcoming-name">{deadline.name}</div>
                <div className="upcoming-meta">
                  Campaign {deadline.deadline_type.toLowerCase()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

export default HrHome;
