import AppLayout from '../layout/AppLayout';
import { getSidebarUser, formatUserName } from '../layout/sidebar-user';
import './hr-home.css';
import {
  ChevronDown,
  Search,
  Bell,
  Plus,
  Folder,
  ArrowUpRight,
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

type DashboardUpcomingReview = {
  campaign_id: number;
  name: string;
  start_date: string;
  participant_count: number;
  form_count: number;
};

type DashboardResponse = {
  campaigns: Campaign[];
  selected_campaign_id: number | null;
  metrics: DashboardMetrics | null;
  forms: DashboardForm[];
  upcoming_reviews: DashboardUpcomingReview[];
};

function HrHome() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );
  const [dashboardMetrics, setDashboardMetrics] =
    useState<DashboardMetrics | null>(null);
  const [dashboardForms, setDashboardForms] = useState<DashboardForm[]>([]);
  const [upcomingReviews, setUpcomingReviews] = useState<
    DashboardUpcomingReview[]
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
      setDashboardForms(dashboard.forms);
      setUpcomingReviews(dashboard.upcoming_reviews);
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

  function getCurrentUser() {
    return sidebarUserName;
  }

  function getTimeOfDay() {
    const currentHour = new Date().getHours();

    if (currentHour >= 5 && currentHour < 12) {
      return 'morning';
    } else if (currentHour >= 12 && currentHour < 18) {
      return 'afternoon';
    } else {
      return 'evening';
    }
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

  function getProgressPercent(submittedCount: number, assignmentCount: number) {
    return assignmentCount === 0
      ? 0
      : Math.round((submittedCount / assignmentCount) * 100);
  }

  return (
    <AppLayout activePage="hr-home" pageClassName="hr-home-page">
      <div className="main-content">
        <div className="topbar">
          <div className="greeting">
            <div className="greeting-title">
              Good {getTimeOfDay()}, {getCurrentUser()}!
            </div>
            <div className="greeting-date">{getFullDate()}</div>
          </div>
          <div className="button-group">
            <div className="btn btn-secondary icon-button">
              <Search size={16} />
            </div>
            <div className="btn btn-secondary icon-button">
              <Bell size={16} />
            </div>
          </div>
        </div>

        <div className="section-header">
          <div className="overview-title">Campaign overview</div>
          {!isDashboardLoading && campaigns.length > 0 && (
            <div className="button-group">
              <div className="btn btn-secondary dashboard-button">
                <ChevronDown size={15} color="#5A6079" />
                <span>All groups</span>
              </div>
              <div className="btn btn-primary dashboard-button">
                <Plus size={15} />
                <span>Add form to campaign</span>
              </div>
            </div>
          )}
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
                    <div className="section-title">Forms in this campaign</div>
                    <div className="section-link">View all forms →</div>
                  </div>

                  <div className="card forms-table">
                    <div className="forms-table-header">
                      <div className="forms-table-heading col-form">Form</div>
                      <div className="forms-table-heading col-completion">
                        Completion
                      </div>
                      <div className="forms-table-heading col-closes">
                        Closes
                      </div>
                      <div className="forms-table-heading col-action"></div>
                    </div>

                    {dashboardForms.length === 0 && (
                      <div className="forms-empty-state">
                        No forms are assigned to this campaign.
                      </div>
                    )}

                    {dashboardForms.map((form) => {
                      const progressPercent = getProgressPercent(
                        form.submitted_count,
                        form.assignment_count,
                      );

                      return (
                        <div className="form-row" key={form.form_id}>
                          <div className="form-info">
                            <div className="form-name">{form.name}</div>
                            <div className="form-audience">{form.audience}</div>
                          </div>
                          <div className="form-progress">
                            <div className="form-progress-label">
                              {form.submitted_count} / {form.assignment_count}{' '}
                              submitted
                            </div>
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{ width: `${progressPercent}%` }}
                              ></div>
                            </div>
                          </div>
                          <div className="form-deadline">
                            <div className="form-due-date">
                              {formatShortDate(form.due_date)}
                            </div>
                            <div className="form-overdue">
                              {form.overdue_count} overdue
                            </div>
                          </div>
                          <div className="btn btn-secondary form-open-button">
                            <ArrowUpRight size={15} />
                          </div>
                        </div>
                      );
                    })}
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
            <div className="section-title">Upcoming reviews</div>
            <div className="section-link">Manage schedule →</div>
          </div>
          <div className="upcoming-list">
            {upcomingReviews.length === 0 && (
              <div className="upcoming-item">
                <div className="upcoming-name">No upcoming reviews</div>
                <div className="upcoming-meta">
                  Create a campaign with a future start date to show it here.
                </div>
              </div>
            )}
            {upcomingReviews.map((review) => (
              <div className="upcoming-item" key={review.campaign_id}>
                <div className="upcoming-date">
                  {formatShortDate(review.start_date)}
                </div>
                <div className="upcoming-name">{review.name}</div>
                <div className="upcoming-meta">
                  {review.participant_count} participants · {review.form_count}{' '}
                  forms
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
