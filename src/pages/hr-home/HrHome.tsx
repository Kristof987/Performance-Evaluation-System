import "./hr-home.css";
import {
  Compass, LayoutDashboard, Users, ClipboardPen, Files,
  ChartNoAxesCombined, Settings, ChevronDown, Search, Bell,
  Plus, Folder, ArrowUpRight, BellRing,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

const API_BASE_URL = "http://localhost:8000";

type Campaign = {
  id: number;
  name: string;
  is_active: boolean;
};

function HrHome() {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [isCampaignListOpen, setIsCampaignListOpen] = useState(false);
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState("");

  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const response = await fetch(`${API_BASE_URL}/campaigns`);

        if (!response.ok) {
          throw new Error(`Campaign request failed with status ${response.status}`);
        }

        const campaignList = await response.json() as Campaign[];
        setCampaigns(campaignList);
        setSelectedCampaignId(campaignList[0]?.id ?? null);
      } catch (error) {
        console.log("Campaigns could not be loaded", error);
        setCampaignsError("Campaigns could not be loaded.");
      } finally {
        setIsCampaignsLoading(false);
      }
    }

    fetchCampaigns();
  }, []);

  const peopleButtonHandler = () => {
    navigate("/people");
  };

  const campaignsButtonHandler = () => {
    navigate("/campaigns");
  };

  const formsButtonHandler = () => {
    navigate("/forms");
  };

  const selectedCampaignDetailsHandler = () => {
    if (selectedCampaign === null) {
      return;
    }

    navigate(`/campaigns/${selectedCampaign.id}`);
  };

  function getCurrentUser() {
    const loggedInUser = sessionStorage.getItem("loggedInUser");

    if (loggedInUser === null) {
      return null;
    }

    return JSON.parse(loggedInUser).username;
  }

  function getTimeOfDay() {
    const currentHour = new Date().getHours();

    if (currentHour >= 5 && currentHour < 12) {
      return "morning";
    } else if (currentHour >= 12 && currentHour < 18) {
      return "afternoon";
    } else {
      return "evening";
    }
  }
  
  function getFullDate() {
    const currentDate = new Date();
    const currentDay = currentDate.getDate().toString();
    const currentMonth = currentDate.toLocaleDateString('en-US', { month: 'long' });
    const currentYear = currentDate.getFullYear().toString();
    const currentDayString = currentDate.toLocaleDateString('en-US', { weekday: 'long' });  //In case of another language, it may not start with capital letter!

    return currentDayString + ", " + currentDay + " " + currentMonth + " " + currentYear;
  }

  return (
    <main className="page">
      <div className="layout">
        <div className="sidebar">
          <div className="company">
            <div className="logo">
              <Compass size={17} />
            </div>
            <div className="company-name">Compass</div>
          </div>

          <div className="sidebar-nav">
            <div className="nav-item active">
              <LayoutDashboard size={17} />
              <div className="nav-item-label">Dashboard</div>
            </div>

            <button type="button" className="nav-item" onClick={peopleButtonHandler}>
              <Users size={17} />
              <div className="nav-item-label">People</div>
            </button>

            <button type="button" className="nav-item" onClick={campaignsButtonHandler}>
              <ClipboardPen size={17} />
              <div className="nav-item-label">Campaigns</div>
            </button>

            <button type="button" className="nav-item" onClick={formsButtonHandler}>
              <Files size={17} />
              <div className="nav-item-label">Forms</div>
            </button>

            <div className="nav-item">
              <ChartNoAxesCombined size={17} />
              <div className="nav-item-label">Reports</div>
            </div>

            <div className="nav-item">
              <Settings size={17} />
              <div className="nav-item-label">Settings</div>
            </div>
          </div>

          <div className="sidebar-spacer"></div>

          <div className="user-menu">
            <div className="user-avatar">
              <div className="user-initials">SM</div>
            </div>
            <div className="user-info">
              <div className="user-name">Sarah Miller</div>
              <div className="user-role">HR Admin</div>
            </div>
            <ChevronDown size={15} color="#8B91A8" />
          </div>
        </div>

        <div className="main-content">
          <div className="topbar">
            <div className="greeting">
              <div className="greeting-title">Good {getTimeOfDay()}, {getCurrentUser()}!</div>
              <div className="greeting-date">{getFullDate()}</div>
            </div>
            <div className="button-group">
              <div className="icon-button">
                <Search size={16} />
              </div>
              <div className="icon-button">
                <Bell size={16} />
              </div>
            </div>
          </div>

          <div className="section-header">
            <div className="overview-title">Campaign overview</div>
            {campaigns.length > 0 && (
              <div className="button-group">
                <div className="button button-secondary">
                  <ChevronDown size={15} color="#5A6079" />
                  <span>All groups</span>
                </div>
                <div className="button button-primary">
                  <Plus size={15} />
                  <span>Add form to campaign</span>
                </div>
              </div>
            )}
          </div>

          {isCampaignsLoading ? (
            <div className="campaign-bar">
              <div className="campaign-selector">
                <Folder size={16} color="#4553C4" />
                <div className="campaign-name">Loading campaigns...</div>
              </div>
            </div>
          ) : campaignsError !== "" ? (
            <div className="empty-campaign-card">
              <div>
                <div className="empty-campaign-title">Campaigns are unavailable</div>
                <div className="empty-campaign-text">Refresh the page after the backend connection is restored.</div>
              </div>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="empty-campaign-card">
              <div>
                <div className="empty-campaign-title">No campaigns yet</div>
                <div className="empty-campaign-text">Create your first campaign to start collecting performance feedback.</div>
              </div>
              <button type="button" className="empty-campaign-button" onClick={campaignsButtonHandler}>Create campaign</button>
            </div>
          ) : (
            <div className="campaign-bar">
              <div className="campaign-selector-wrap">
                <button type="button" className="campaign-selector" onClick={() => setIsCampaignListOpen(!isCampaignListOpen)}>
                  <Folder size={16} color="#4553C4" />
                  <div className="campaign-name">{selectedCampaign?.name}</div>
                  <div className="campaign-status">{selectedCampaign?.is_active ? "Active" : "Closed"}</div>
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
                          setSelectedCampaignId(campaign.id);
                          setIsCampaignListOpen(false);
                        }}
                      >
                        <span>{campaign.name}</span>
                        <span>{campaign.is_active ? "Active" : "Closed"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" className="campaign-details-link" onClick={selectedCampaignDetailsHandler}>View campaign details →</button>
            </div>
          )}

          {campaigns.length > 0 && (
            <>
              <div className="metrics">
                <div className="metric-card">
                  <div className="metric-label">Completion rate</div>
                  <div className="metric-value accent">72%</div>
                  <div className="metric-context">184 of 256 assignments submitted</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Awaiting submission</div>
                  <div className="metric-value">72</div>
                  <div className="metric-context">48 not started · 24 in progress</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Overdue</div>
                  <div className="metric-value danger">12</div>
                  <div className="metric-context">Across 3 forms</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Upcoming reviews</div>
                  <div className="metric-value">3</div>
                  <div className="metric-context">Next review · 1 Oct 2026</div>
                </div>
              </div>

              <div className="workspace">
                <div className="forms-section">
                  <div className="section-header">
                    <div className="section-title">Forms in this campaign</div>
                    <div className="section-link">View all forms →</div>
                  </div>

                  <div className="forms-table">
                    <div className="forms-table-header">
                      <div className="forms-table-heading col-form">Form</div>
                      <div className="forms-table-heading col-completion">Completion</div>
                      <div className="forms-table-heading col-closes">Closes</div>
                      <div className="forms-table-heading col-action"></div>
                    </div>

                <div className="form-row">
                  <div className="form-info">
                    <div className="form-name">September feedback</div>
                    <div className="form-audience">All groups</div>
                  </div>
                  <div className="form-progress">
                    <div className="form-progress-label">112 / 144 submitted</div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: "77.78%" }}></div>
                    </div>
                  </div>
                  <div className="form-deadline">
                    <div className="form-due-date">30 Sep 2026</div>
                    <div className="form-overdue">6 overdue</div>
                  </div>
                  <div className="form-open-button">
                    <ArrowUpRight size={15} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-info">
                    <div className="form-name">Engineering peer review</div>
                    <div className="form-audience">Engineering</div>
                  </div>
                  <div className="form-progress">
                    <div className="form-progress-label">48 / 72 submitted</div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: "66.67%" }}></div>
                    </div>
                  </div>
                  <div className="form-deadline">
                    <div className="form-due-date">24 Sep 2026</div>
                    <div className="form-overdue">4 overdue</div>
                  </div>
                  <div className="form-open-button">
                    <ArrowUpRight size={15} />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-info">
                    <div className="form-name">Manager feedback</div>
                    <div className="form-audience">All groups</div>
                  </div>
                  <div className="form-progress">
                    <div className="form-progress-label">24 / 40 submitted</div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: "60%" }}></div>
                    </div>
                  </div>
                  <div className="form-deadline">
                    <div className="form-due-date">3 Oct 2026</div>
                    <div className="form-overdue">2 overdue</div>
                  </div>
                  <div className="form-open-button">
                    <ArrowUpRight size={15} />
                  </div>
                </div>
              </div>
            </div>

            <div className="next-actions">
              <div className="section-title">Next Actions</div>

              <div className="overdue-alert">
                <div className="overdue-alert-title">12 submissions are overdue</div>
                <div className="overdue-alert-text">
                  Follow up with reviewers who missed their deadline.
                </div>
                <div className="reminder-button">
                  <BellRing size={14} />
                  <span>Send reminders</span>
                </div>
              </div>

              <div className="publish-card">
                <div className="publish-card-title">Results ready to publish</div>
                <div className="publish-card-context">Product team check-in · 18 people</div>
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
              <div className="upcoming-item">
                <div className="upcoming-date">1 Oct 2026 · 09:00</div>
                <div className="upcoming-name">Q4 development check-in</div>
                <div className="upcoming-meta">48 participants · Self-assessment</div>
              </div>
              <div className="upcoming-item">
                <div className="upcoming-date">8 Oct 2026 · 09:00</div>
                <div className="upcoming-name">Product peer feedback</div>
                <div className="upcoming-meta">24 participants · Peer review</div>
              </div>
              <div className="upcoming-item">
                <div className="upcoming-date">1 Dec 2026 · 09:00</div>
                <div className="upcoming-name">Year-end reflection</div>
                <div className="upcoming-meta">96 participants · Self-assessment</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default HrHome;
