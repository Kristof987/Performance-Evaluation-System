import AppLayout from '../layout/AppLayout';
import { Bell, Search } from 'lucide-react';
import '../hr-home/hr-home.css';
import './forms.css';

export default function Forms() {
  return (
    <AppLayout activePage="forms" pageClassName="forms-page">
      <div className="main-content forms-editor-main">
        <div className="forms-editor-top-actions">
          <button
            className="btn btn-secondary forms-editor-icon-btn"
            type="button"
            aria-label="Search"
          >
            <Search size={16} />
          </button>
          <button
            className="btn btn-secondary forms-editor-icon-btn"
            type="button"
            aria-label="Notifications"
          >
            <Bell size={16} />
          </button>
        </div>

        <section className="forms-editor-hello">
          <h1>Form editor</h1>
          <p>
            Create reusable questionnaires only. Campaign assignment happens
            elsewhere.
          </p>
        </section>

        <section className="forms-editor-page-head">
          <div className="forms-editor-title">
            <h2>Questionnaire builder</h2>
            <p>
              Build sections, questions, required rules, help text and
              conditional display logic.
            </p>
          </div>
          <div className="forms-editor-actions">
            <button className="btn btn-secondary" type="button">
              Delete form
            </button>
            <button className="btn btn-primary" type="button">
              Create form
            </button>
          </div>
        </section>

        <section className="forms-editor-workspace">
          <aside className="card forms-editor-card forms-list-panel">
            <div className="forms-editor-card-head">
              <h3>Forms</h3>
              <button className="btn btn-secondary" type="button">
                New
              </button>
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

          <section className="card forms-editor-card forms-editor-panel">
            <div className="forms-editor-form-title">
              <input
                className="form-control"
                aria-label="Form title"
                defaultValue="Performance review form"
              />
              <textarea
                className="form-control"
                aria-label="Form description"
                defaultValue="Reusable questionnaire for structured employee performance reviews."
              />
            </div>

            <div className="forms-editor-section">
              <div className="forms-editor-section-head">
                <h3>Section 1 · Goals and impact</h3>
                <button className="btn btn-secondary" type="button">
                  Add section
                </button>
              </div>
              <Question
                active
                title="How would you rate goal achievement?"
                meta="Scale question · Help text enabled"
                pills={['Required', '1-5 scale']}
              />
              <Question
                title="Describe the biggest contribution this cycle."
                meta="Long text question"
                pills={['Required', 'Text']}
              />
              <Question
                title="Which skills improved most?"
                meta="Multiple choice question"
                pills={['Optional', 'Multi choice']}
                mutedFirst
              />
              <div className="forms-editor-add-row">
                <button className="btn btn-secondary" type="button">
                  Add question
                </button>
                <button className="btn btn-secondary" type="button">
                  Duplicate section
                </button>
                <button className="btn btn-secondary" type="button">
                  Delete section
                </button>
              </div>
            </div>

            <div className="forms-editor-section">
              <div className="forms-editor-section-head">
                <h3>Section 2 · Development</h3>
                <button className="btn btn-secondary" type="button">
                  Reorder
                </button>
              </div>
              <Question
                title="What should be the next development focus?"
                meta="Display rule: show if rating is 3 or below"
                pills={['Display rule', 'Text']}
                mutedFirst
              />
            </div>
          </section>

          <aside className="card forms-editor-card forms-editor-settings-panel">
            <div className="forms-editor-card-head">
              <h3>Question settings</h3>
            </div>
            <div className="forms-editor-props">
              <div className="form-field forms-editor-field">
                <label className="form-label" htmlFor="forms-question-text">
                  Question text
                </label>
                <textarea
                  id="forms-question-text"
                  className="form-control"
                  defaultValue="How would you rate goal achievement?"
                />
              </div>
              <div className="form-field forms-editor-field">
                <label className="form-label" htmlFor="forms-question-type">
                  Question type
                </label>
                <select
                  id="forms-question-type"
                  className="form-control"
                  defaultValue="Scale 1-5"
                >
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
              <div className="form-field forms-editor-field">
                <label className="form-label" htmlFor="forms-help-text">
                  Help text
                </label>
                <textarea
                  id="forms-help-text"
                  className="form-control"
                  defaultValue="Consider goals agreed at the beginning of the cycle."
                />
              </div>
              <div className="form-field forms-editor-field">
                <label className="form-label" htmlFor="forms-display-rule">
                  Display rule
                </label>
                <select
                  id="forms-display-rule"
                  className="form-control"
                  defaultValue="Always show this question"
                >
                  <option>Always show this question</option>
                  <option>
                    Show only if a previous answer matches a condition
                  </option>
                </select>
              </div>
              <div className="forms-editor-note">
                Display rule controls whether this question appears based on an
                earlier answer.
              </div>
            </div>
          </aside>
        </section>
      </div>
    </AppLayout>
  );
}

type QuestionProps = {
  title: string;
  meta: string;
  pills: string[];
  active?: boolean;
  mutedFirst?: boolean;
};

function Question({
  title,
  meta,
  pills,
  active = false,
  mutedFirst = false,
}: QuestionProps) {
  return (
    <div className={`card forms-editor-question${active ? ' active' : ''}`}>
      <div className="forms-editor-drag">⋮⋮</div>
      <div className="forms-editor-q-main">
        <strong>{title}</strong>
        <span>{meta}</span>
      </div>
      <div className="forms-editor-q-meta">
        {pills.map((pill, index) => (
          <span
            key={pill}
            className={`badge ${mutedFirst || index > 0 ? 'badge-neutral' : 'badge-primary'}`}
          >
            {pill}
          </span>
        ))}
      </div>
    </div>
  );
}
