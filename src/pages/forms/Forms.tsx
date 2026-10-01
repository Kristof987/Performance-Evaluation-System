import { useNavigate } from 'react-router';
import {
  Bell,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardPen,
  Compass,
  FileText,
  LayoutDashboard,
  Search,
  Settings,
  Users,
} from 'lucide-react';
import './forms.css';

export default function Forms() {
  const navigate = useNavigate();

  return (
    <div className="forms-editor-app">
      <aside className="forms-editor-sidebar">
        <div className="forms-editor-brand">
          <div className="forms-editor-mark">
            <Compass size={17} />
          </div>
          <div className="forms-editor-company-name">Compass</div>
        </div>

        <nav className="forms-editor-nav">
          <button className="forms-editor-nav-item" type="button" onClick={() => navigate('/hr-home')}>
            <LayoutDashboard />
            Dashboard
          </button>
          <button className="forms-editor-nav-item" type="button" onClick={() => navigate('/people')}>
            <Users />
            People
          </button>
          <button className="forms-editor-nav-item" type="button" onClick={() => navigate('/campaigns')}>
            <ClipboardPen />
            Campaigns
          </button>
          <button className="forms-editor-nav-item active" type="button" onClick={() => navigate('/forms')}>
            <FileText />
            Forms
          </button>
          <div className="forms-editor-nav-item">
            <ChartNoAxesCombined />
            Reports
          </div>
          <div className="forms-editor-nav-item">
            <Settings />
            Settings
          </div>
        </nav>

        <div className="forms-editor-profile">
          <div className="forms-editor-avatar">SM</div>
          <div className="forms-editor-profile-info">
            <div className="forms-editor-profile-name">Sarah Miller</div>
            <div className="forms-editor-profile-role">HR Admin</div>
          </div>
          <ChevronDown size={15} color="#8B91A8" />
        </div>
      </aside>

      <main className="forms-editor-main">
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
      </main>
    </div>
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
