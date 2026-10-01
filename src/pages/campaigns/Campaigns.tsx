import './campaigns.css';
import '../hr-home/hr-home.css';
import { Link, useParams } from 'react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardPen,
  Compass,
  Files,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:8000';

type CampaignStatus = 'Active' | 'Closed';

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  start: string;
  end: string;
  description: string | null;
  comment: string | null;
  sent: number;
  done: number;
  overdue: number;
  resultsReady?: boolean;
  forms: Array<[string, string, number, number, string]>;
};

type CampaignResponse = {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  comment: string | null;
};

type LoggedInUser = {
  id: number;
};

function CampaignPage({ children }: { children: ReactNode }) {
  return (
    <main className="page campaign-page">
      <div className="layout">
        <aside className="sidebar">
          <div className="company">
            <div className="logo"><Compass size={17} /></div>
            <div className="company-name">Compass</div>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            <Link className="nav-item" to="/hr-home" style={{ textDecoration: 'none' }}>
              <LayoutDashboard size={17} />
              <span className="nav-item-label">Dashboard</span>
            </Link>
            <Link className="nav-item" to="/people" style={{ textDecoration: 'none' }}>
              <Users size={17} />
              <span className="nav-item-label">People</span>
            </Link>
            <Link
              className="nav-item active"
              to="/campaigns"
              aria-current="page"
              style={{ textDecoration: 'none' }}
            >
              <ClipboardPen size={17} />
              <span className="nav-item-label">Campaigns</span>
            </Link>
            <Link className="nav-item" to="/forms" style={{ textDecoration: 'none' }}>
              <Files size={17} />
              <span className="nav-item-label">Forms</span>
            </Link>
            <div className="nav-item"><ChartNoAxesCombined size={17} /><span className="nav-item-label">Reports</span></div>
            <div className="nav-item"><Settings size={17} /><span className="nav-item-label">Settings</span></div>
          </nav>

          <div className="sidebar-spacer" />

          <div className="user-menu">
            <div className="user-avatar"><div className="user-initials">SM</div></div>
            <div className="user-info">
              <div className="user-name">Sarah Miller</div>
              <div className="user-role">HR Admin</div>
            </div>
            <ChevronDown size={15} color="#8B91A8" />
          </div>
        </aside>

        <div className="main-content campaign-content">{children}</div>
      </div>
    </main>
  );
}

type CampaignForm = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  comment: string;
};

const emptyCampaignForm: CampaignForm = {
  name: '',
  description: '',
  startDate: '',
  endDate: '',
  isActive: true,
  comment: '',
};

function formatDate(value: string) {
  if (!value) return 'No end date';

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function mapCampaignFromResponse(campaign: CampaignResponse): Campaign {
  return {
    id: campaign.id.toString(),
    name: campaign.name,
    status: campaign.is_active ? 'Active' : 'Closed',
    start: formatDate(campaign.start_date),
    end: formatDate(campaign.end_date ?? ''),
    description: campaign.description,
    comment: campaign.comment,
    sent: 0,
    done: 0,
    overdue: 0,
    forms: [],
  };
}

export function Campaigns() {
  const [campaignList, setCampaignList] = useState<Campaign[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All statuses' | CampaignStatus>('All statuses');
  const [isCampaignsLoading, setIsCampaignsLoading] = useState(true);
  const [campaignsError, setCampaignsError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState<CampaignForm>(emptyCampaignForm);

  const filteredCampaigns = campaignList.filter((campaign) => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    const matchesStatus = statusFilter === 'All statuses' || campaign.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const response = await fetch(`${API_BASE_URL}/campaigns`);

        if (!response.ok) {
          throw new Error(`Campaign request failed with status ${response.status}`);
        }

        const campaigns = await response.json() as CampaignResponse[];
        setCampaignList(campaigns.map(mapCampaignFromResponse));
      } catch (error) {
        console.log('Campaigns could not be loaded', error);
        setCampaignsError('Campaigns could not be loaded.');
      } finally {
        setIsCampaignsLoading(false);
      }
    }

    fetchCampaigns();
  }, []);

  const updateForm = <K extends keyof CampaignForm>(field: K, value: CampaignForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const closeCreate = () => {
    setIsCreateOpen(false);
    setForm(emptyCampaignForm);
  };

  const handleCreateCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const loggedInUser = sessionStorage.getItem('loggedInUser');

    if (loggedInUser === null) {
      alert('Please sign in before creating a campaign.');
      return;
    }

    const currentUser = JSON.parse(loggedInUser) as LoggedInUser;

    const response = await fetch(`${API_BASE_URL}/campaigns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        start_date: form.startDate,
        end_date: form.endDate || null,
        is_active: form.isActive,
        comment: form.comment || null,
        created_by: currentUser.id,
      }),
    });

    if (!response.ok) {
      alert('Campaign could not be saved.');
      return;
    }

    const savedCampaign = await response.json() as CampaignResponse;

    setCampaignList((current) => [mapCampaignFromResponse(savedCampaign), ...current]);
    closeCreate();
  };

  return (
    <CampaignPage>
      <div className="campaign-view">
      <div className="campaign-heading">
        <div>
          <h1>Campaigns</h1>
          <p>Current and past performance review campaigns</p>
        </div>
        <div className="campaign-heading-actions">
          <button className="campaign-create-button" type="button" onClick={() => setIsCreateOpen(true)}>
            Create campaign
          </button>
          <Link to="/hr-home">Back to dashboard</Link>
        </div>
      </div>

      <div className="campaign-overview-stats">
        <div className="campaign-mini-stat">
          <span>Total campaigns</span>
          <strong>{campaignList.length}</strong>
        </div>
        <div className="campaign-mini-stat">
          <span>Active</span>
          <strong>{campaignList.filter((campaign) => campaign.status === 'Active').length}</strong>
        </div>
        <div className="campaign-mini-stat">
          <span>Closed</span>
          <strong>{campaignList.filter((campaign) => campaign.status === 'Closed').length}</strong>
        </div>
      </div>

      <div className="campaign-filter-bar">
        <div className="campaign-filter-title">
          <strong>Filter campaigns</strong>
          <span>Search by name or narrow by status</span>
        </div>

        <div className="campaign-filters">
          <input aria-label="Search campaigns" placeholder="Search campaigns..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All statuses' | CampaignStatus)}>
            <option>All statuses</option>
            <option>Active</option>
            <option>Closed</option>
          </select>
          <button className="campaign-clear" type="button" onClick={() => {
            setSearchQuery('');
            setStatusFilter('All statuses');
          }}>Reset</button>
        </div>
      </div>

      <div className="campaign-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Period</th>
              <th>Completion</th>
              <th>Forms</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isCampaignsLoading && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>Loading campaigns...</td>
              </tr>
            )}
            {campaignsError !== '' && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>{campaignsError}</td>
              </tr>
            )}
            {!isCampaignsLoading && campaignsError === '' && campaignList.length === 0 && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>No campaigns have been created yet.</td>
              </tr>
            )}
            {!isCampaignsLoading && campaignsError === '' && campaignList.length > 0 && filteredCampaigns.length === 0 && (
              <tr>
                <td className="campaign-state-cell" colSpan={6}>No campaigns match the current filters.</td>
              </tr>
            )}
            {filteredCampaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <strong>{campaign.name}</strong>
                </td>
                <td>
                  <span className="status-pill">{campaign.status}</span>
                </td>
                <td>
                  {campaign.start} - {campaign.end}
                </td>
                <td>
                  {campaign.sent === 0 ? '0%' : `${Math.round((campaign.done / campaign.sent) * 100)}%`}
                  <progress value={campaign.done} max={campaign.sent || 1} />
                </td>
                <td>{campaign.forms.length}</td>
                <td>
                  <Link to={`/campaigns/${campaign.id}`}>{'Manage campaign ->'}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      {isCreateOpen && (
        <div className="campaign-modal-backdrop" role="presentation">
          <section className="campaign-modal" role="dialog" aria-modal="true" aria-labelledby="create-campaign-title">
            <div className="campaign-modal-header">
              <div>
                <span className="campaign-modal-eyebrow">New campaign</span>
                <h2 id="create-campaign-title">Create campaign</h2>
                <p>Fill the fields from the Campaign model before assigning forms and groups.</p>
              </div>
              <button className="campaign-modal-close" type="button" aria-label="Close create campaign" onClick={closeCreate}>×</button>
            </div>

            <form className="campaign-create-form" onSubmit={handleCreateCampaign}>
              <label className="campaign-field campaign-field-wide">
                <span>Campaign name *</span>
                <input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="e.g. Winter 2027 review" />
              </label>

              <label className="campaign-field campaign-field-wide">
                <span>Description</span>
                <textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Short summary shown to HR admins and participants" rows={3} />
              </label>

              <label className="campaign-field">
                <span>Start date *</span>
                <input required type="date" value={form.startDate} onChange={(event) => updateForm('startDate', event.target.value)} />
              </label>

              <label className="campaign-field">
                <span>End date</span>
                <input type="date" value={form.endDate} onChange={(event) => updateForm('endDate', event.target.value)} />
              </label>

              <label className="campaign-field">
                <span>Status</span>
                <select value={form.isActive ? 'active' : 'closed'} onChange={(event) => updateForm('isActive', event.target.value === 'active')}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </label>

              <label className="campaign-field">
                <span>Created by</span>
                <input value="Sarah Miller (current user)" disabled />
              </label>

              <label className="campaign-field campaign-field-wide">
                <span>Internal comment</span>
                <textarea value={form.comment} onChange={(event) => updateForm('comment', event.target.value)} placeholder="Optional HR-only note" rows={3} />
              </label>

              <div className="campaign-form-summary">
                <strong>Next step</strong>
                <span>After creating the campaign you can open it and attach forms, company groups, and evaluation rules.</span>
              </div>

              <div className="campaign-modal-actions">
                <button className="campaign-secondary-button" type="button" onClick={closeCreate}>Cancel</button>
                <button className="campaign-create-button" type="submit">Save campaign</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </CampaignPage>
  );
}

export function CampaignDetails() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isCampaignLoading, setIsCampaignLoading] = useState(true);
  const [campaignError, setCampaignError] = useState('');

  useEffect(() => {
    async function fetchCampaign() {
      if (id === undefined) {
        setCampaignError('Campaign not found.');
        setIsCampaignLoading(false);
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/campaigns/${id}`);

        if (!response.ok) {
          throw new Error(`Campaign request failed with status ${response.status}`);
        }

        const campaignResponse = await response.json() as CampaignResponse;
        setCampaign(mapCampaignFromResponse(campaignResponse));
      } catch (error) {
        console.log('Campaign could not be loaded', error);
        setCampaignError('Campaign could not be loaded.');
      } finally {
        setIsCampaignLoading(false);
      }
    }

    fetchCampaign();
  }, [id]);

  if (isCampaignLoading) {
    return <CampaignPage><div className="campaign-view"><p>Loading campaign...</p></div></CampaignPage>;
  }

  if (campaign === null) {
    return <CampaignPage><div className="campaign-view"><p>{campaignError || 'Campaign not found.'}</p></div></CampaignPage>;
  }

  return (
    <CampaignPage>
      <div className="campaign-view">
      <div className="campaign-heading">
        <div>
          <Link to="/campaigns">{'<- All campaigns'}</Link>
          <h1>{campaign.name}</h1>
          <p>
            <span className="status-pill">{campaign.status}</span>
            {campaign.start} - {campaign.end}
          </p>
        </div>
        <Link to="/hr-home">Back to dashboard</Link>
      </div>

      <div className="campaign-stats">
        <div className="campaign-stat">
          <span>Completion rate</span>
          <strong>{campaign.sent === 0 ? '0%' : `${Math.round((campaign.done / campaign.sent) * 100)}%`}</strong>
        </div>
        <div className="campaign-stat">
          <span>Submitted</span>
          <strong>{campaign.done} / {campaign.sent}</strong>
        </div>
        <div className="campaign-stat">
          <span>{campaign.status === 'Closed' ? 'Not submitted' : 'Awaiting submission'}</span>
          <strong>{campaign.sent - campaign.done}</strong>
        </div>
        <div className="campaign-stat">
          <span>Forms</span>
          <strong>{campaign.forms.length}</strong>
        </div>
      </div>

      <h2>Forms & assigned groups</h2>

      <div className="campaign-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Form</th>
              <th>Groups</th>
              <th>Completion</th>
              <th>Due date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campaign.forms.map((form) => (
              <tr key={form[0]}>
                <td><strong>{form[0]}</strong></td>
                <td>{form[1]}</td>
                <td>
                  {form[2]} / {form[3]}
                  <progress value={form[2]} max={form[3]} />
                </td>
                <td>{form[4]}</td>
                <td>
                  <button type="button" className="campaign-link">{'View groups ->'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="sample-note">
        Campaign data loaded from the database.
        {campaign.status === 'Closed'
          ? ' This campaign is closed and read-only.'
          : ' Review assignments and deadlines within each form.'}
      </p>
      </div>
    </CampaignPage>
  );
}

export default Campaigns;
