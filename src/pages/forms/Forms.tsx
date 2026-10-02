import { useNavigate } from 'react-router';
import { useState } from 'react';
import {
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardPen,
  Compass,
  Files,
  LayoutDashboard,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import '../hr-home/hr-home.css';
import './forms.css';

type SidebarUser = {
  username: string;
  profile_image_url: string | null;
};

function getSidebarUser() {
  const loggedInUser = sessionStorage.getItem('loggedInUser');

  if (loggedInUser === null) {
    return null;
  }

  return JSON.parse(loggedInUser) as SidebarUser;
}

function formatUserName(username: string) {
  const name = username.split('@')[0].replace(/[._-]+/g, ' ').trim();

  return name.split(' ').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function getUserInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'U';
}

export default function Forms() {
  const navigate = useNavigate();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const sidebarUser = getSidebarUser();
  const sidebarUserName = sidebarUser === null ? 'User' : formatUserName(sidebarUser.username);

  return (
    <main className="page forms-page">
      <div className={`layout${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
        <aside className="sidebar">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? 'Open sidebar' : 'Close sidebar'}
            aria-expanded={!isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            <span />
          </button>

          <div className="company">
            <div className="logo">
              <Compass size={17} />
            </div>
            <div className="company-name">Compass</div>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            <button className="nav-item" type="button" onClick={() => navigate('/hr-home')}>
              <LayoutDashboard size={17} />
              <span className="nav-item-label">Dashboard</span>
            </button>
            <button className="nav-item" type="button" onClick={() => navigate('/people')}>
              <Users size={17} />
              <span className="nav-item-label">People</span>
            </button>
            <button className="nav-item" type="button" onClick={() => navigate('/campaigns')}>
              <ClipboardPen size={17} />
              <span className="nav-item-label">Campaigns</span>
            </button>
            <button className="nav-item active" type="button" onClick={() => navigate('/forms')}>
              <Files size={17} />
              <span className="nav-item-label">Forms</span>
            </button>
            <div className="nav-item">
              <ChartNoAxesCombined size={17} />
              <span className="nav-item-label">Reports</span>
            </div>
            <div className="nav-item">
              <Settings size={17} />
              <span className="nav-item-label">Settings</span>
            </div>
          </nav>

          <div className="sidebar-spacer" />

          <div className="user-menu">
            <div className="user-avatar">
              {sidebarUser?.profile_image_url ? (
                <img src={sidebarUser.profile_image_url} alt={sidebarUserName} />
              ) : (
                <div className="user-initials">{getUserInitials(sidebarUserName)}</div>
              )}
            </div>
            <div className="user-info">
              <div className="user-name">{sidebarUserName}</div>
              <div className="user-role">HR Admin</div>
            </div>
            <button className="user-menu-toggle" type="button" aria-label="Open user menu" onClick={() => setIsUserMenuOpen((current) => !current)}>
              <ChevronDown size={15} color="#8B91A8" />
            </button>
            {isUserMenuOpen && (
              <div className="user-settings-menu open">
                <button type="button">Settings</button>
              </div>
            )}
          </div>
        </aside>

        <div className="main-content forms-editor-main">
        <div className="forms-editor-top-actions">
          <button className="forms-editor-icon-btn" type="button" aria-label="Search">
            <Search size={16} />
          </button>
          <button className="forms-editor-icon-btn" type="button" aria-label="Notifications">
            <Bell size={16} />
          </button>
        </div>

        <section className="forms-editor-hello">
          <h1>Form editor</h1>
          <p>Create reusable questionnaires only. Campaign assignment happens elsewhere.</p>
        </section>

        <section className="forms-editor-page-head">
          <div className="forms-editor-title">
            <h2>Questionnaire builder</h2>
            <p>Build sections, questions, required rules, help text and conditional display logic.</p>
          </div>
          <div className="forms-editor-actions">
            <button className="forms-editor-btn" type="button">Delete form</button>
            <button className="forms-editor-btn primary" type="button">Create form</button>
          </div>
        </section>

        <section className="forms-editor-workspace">
          <aside className="forms-editor-card forms-list-panel">
            <div className="forms-editor-card-head">
              <h3>Forms</h3>
              <button className="forms-editor-btn" type="button">New</button>
            </div>
            <div className="forms-editor-list">
              <div className="forms-editor-form-item active">
                <strong>Performance review</strong>
                <span>3 sections · 12 questions</span>
              </div>
              <div className="forms-editor-form-item">
                <strong>Self-assessment</strong>
                <span>2 sections · 8 questions</span>
              </div>
              <div className="forms-editor-form-item">
                <strong>Peer feedback</strong>
                <span>2 sections · 9 questions</span>
              </div>
            </div>
            <div className="forms-editor-card-head">
              <h3>Templates</h3>
            </div>
            <div className="forms-editor-list">
              <div className="forms-editor-template-item">
                <strong>Manager feedback</strong>
                <span>Use and customize</span>
              </div>
              <div className="forms-editor-template-item">
                <strong>Engagement survey</strong>
                <span>Use and customize</span>
              </div>
            </div>
          </aside>

          <section className="forms-editor-card forms-editor-panel">
            <div className="forms-editor-form-title">
              <input defaultValue="Performance review form" />
              <textarea defaultValue="Reusable questionnaire for structured employee performance reviews." />
            </div>

            <div className="forms-editor-section">
              <div className="forms-editor-section-head">
                <h3>Section 1 · Goals and impact</h3>
                <button className="forms-editor-btn" type="button">Add section</button>
              </div>
              <Question active title="How would you rate goal achievement?" meta="Scale question · Help text enabled" pills={['Required', '1-5 scale']} />
              <Question title="Describe the biggest contribution this cycle." meta="Long text question" pills={['Required', 'Text']} />
              <Question title="Which skills improved most?" meta="Multiple choice question" pills={['Optional', 'Multi choice']} mutedFirst />
              <div className="forms-editor-add-row">
                <button className="forms-editor-btn" type="button">Add question</button>
                <button className="forms-editor-btn" type="button">Duplicate section</button>
                <button className="forms-editor-btn" type="button">Delete section</button>
              </div>
            </div>

            <div className="forms-editor-section">
              <div className="forms-editor-section-head">
                <h3>Section 2 · Development</h3>
                <button className="forms-editor-btn" type="button">Reorder</button>
              </div>
              <Question title="What should be the next development focus?" meta="Display rule: show if rating is 3 or below" pills={['Display rule', 'Text']} mutedFirst />
            </div>
          </section>

          <aside className="forms-editor-card forms-editor-settings-panel">
            <div className="forms-editor-card-head">
              <h3>Question settings</h3>
            </div>
            <div className="forms-editor-props">
              <div className="forms-editor-field">
                <label>Question text</label>
                <textarea defaultValue="How would you rate goal achievement?" />
              </div>
              <div className="forms-editor-field">
                <label>Question type</label>
                <select defaultValue="Scale 1-5">
                  <option>Scale 1-5</option>
                  <option>Scale 1-10</option>
                  <option>Text</option>
                  <option>Number</option>
                  <option>Single choice</option>
                  <option>Multiple choice</option>
                  <option>Date</option>
                  <option>File upload</option>
                </select>
              </div>
              <div className="forms-editor-switch">
                <span>Required question</span>
                <input type="checkbox" defaultChecked />
              </div>
              <div className="forms-editor-field">
                <label>Help text</label>
                <textarea defaultValue="Consider goals agreed at the beginning of the cycle." />
              </div>
              <div className="forms-editor-field">
                <label>Display rule</label>
                <select defaultValue="Always show this question">
                  <option>Always show this question</option>
                  <option>Show only if a previous answer matches a condition</option>
                </select>
              </div>
              <div className="forms-editor-note">
                Display rule controls whether this question appears based on an earlier answer.
              </div>
            </div>
          </aside>
        </section>
        </div>
      </div>
    </main>
  );
}

type QuestionProps = {
  title: string;
  meta: string;
  pills: string[];
  active?: boolean;
  mutedFirst?: boolean;
};

function Question({ title, meta, pills, active = false, mutedFirst = false }: QuestionProps) {
  return (
    <div className={`forms-editor-question${active ? ' active' : ''}`}>
      <div className="forms-editor-drag">⋮⋮</div>
      <div className="forms-editor-q-main">
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="forms-editor-q-meta">
        {pills.map((pill, index) => (
          <span key={pill} className={`forms-editor-pill${mutedFirst || index > 0 ? ' gray' : ''}`}>
            {pill}
          </span>
        ))}
      </div>
    </div>
  );
}
