import './campaigns.css';
import './hr-home.css';
import { Link, useParams } from 'react-router';
import type { ReactNode } from 'react';
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

type CampaignStatus = 'Active' | 'Closed';

type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  start: string;
  end: string;
  sent: number;
  done: number;
  overdue: number;
  resultsReady?: boolean;
  forms: Array<[string, string, number, number, string]>;
};

const campaigns: Campaign[] = [
  {
    id: 'autumn-2026',
    name: 'Autumn 2026',
    status: 'Active',
    start: '1 Sep 2026',
    end: '31 Oct 2026',
    sent: 256,
    done: 184,
    overdue: 12,
    forms: [
      ['September feedback', 'All groups', 112, 144, '30 Sep 2026'],
      ['Engineering peer review', 'Developers, Testers', 48, 72, '24 Sep 2026'],
      ['Manager feedback', 'Managers', 24, 40, '3 Oct 2026'],
    ],
  },
  {
    id: 'spring-2026',
    name: 'Spring 2026',
    status: 'Closed',
    resultsReady: true,
    start: '1 Mar 2026',
    end: '30 Apr 2026',
    sent: 220,
    done: 220,
    overdue: 0,
    forms: [
      ['Self-assessment', 'All groups', 100, 100, '15 Apr 2026'],
      ['Peer feedback', 'Developers, Testers', 80, 80, '22 Apr 2026'],
      ['Manager feedback', 'Managers', 40, 40, '30 Apr 2026'],
    ],
  },
  {
    id: 'autumn-2025',
    name: 'Autumn 2025',
    status: 'Closed',
    start: '1 Sep 2025',
    end: '31 Oct 2025',
    sent: 200,
    done: 192,
    overdue: 0,
    forms: [
      ['Self-assessment', 'All groups', 96, 100, '15 Oct 2025'],
      ['Peer feedback', 'Developers, Testers', 64, 68, '22 Oct 2025'],
      ['Manager feedback', 'Managers', 32, 32, '31 Oct 2025'],
    ],
  },
];

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

export function Campaigns() {
  return (
    <CampaignPage>
      <div className="campaign-view">
      <div className="campaign-heading">
        <div>
          <h1>Campaigns</h1>
          <p>Current and past performance review campaigns</p>
        </div>
        <Link to="/hr-home">Back to dashboard</Link>
      </div>

      <div className="campaign-overview-stats">
        <div className="campaign-mini-stat">
          <span>Total campaigns</span>
          <strong>{campaigns.length}</strong>
        </div>
        <div className="campaign-mini-stat">
          <span>Active</span>
          <strong>{campaigns.filter((campaign) => campaign.status === 'Active').length}</strong>
        </div>
        <div className="campaign-mini-stat">
          <span>Closed</span>
          <strong>{campaigns.filter((campaign) => campaign.status === 'Closed').length}</strong>
        </div>
      </div>

      <div className="campaign-filter-bar">
        <div className="campaign-filter-title">
          <strong>Filter campaigns</strong>
          <span>Search by name or narrow by status</span>
        </div>

        <div className="campaign-filters">
          <input aria-label="Search campaigns" placeholder="Search campaigns..." />
          <select aria-label="Filter by status">
            <option>All statuses</option>
            <option>Active</option>
            <option>Closed</option>
          </select>
          <button className="campaign-clear" type="button">Reset</button>
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
            {campaigns.map((campaign) => (
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
                  {Math.round((campaign.done / campaign.sent) * 100)}%
                  <progress value={campaign.done} max={campaign.sent} />
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
    </CampaignPage>
  );
}

export function CampaignDetails() {
  const { id } = useParams();
  const campaign = campaigns.find((item) => item.id === id) ?? campaigns[0];

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
          <strong>{Math.round((campaign.done / campaign.sent) * 100)}%</strong>
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
        Illustrative campaign data.
        {campaign.status === 'Closed'
          ? ' This campaign is closed and read-only.'
          : ' Review assignments and deadlines within each form.'}
      </p>
      </div>
    </CampaignPage>
  );
}

export default Campaigns;
