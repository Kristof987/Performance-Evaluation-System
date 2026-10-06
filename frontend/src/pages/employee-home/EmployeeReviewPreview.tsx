import { Calendar, ClipboardCheck, ClipboardList, MessageCircle, Target, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import AppLayout from '../layout/AppLayout';
import './employee-home.css';

const previewTasks = [
  {
    id: 1,
    formName: 'Self-review',
    meta: 'H2 2026 review • about Adam Smith • 12 questions',
    due: 'Nov 15, 2026',
    status: 'In progress',
    tone: 'progress',
    action: 'Continue',
  },
  {
    id: 2,
    formName: 'Peer review - Jane Doe',
    meta: 'H2 2026 review • about Jane Doe • 8 questions',
    due: 'Nov 20, 2026',
    status: 'Not started',
    tone: 'waiting',
    action: 'Start',
  },
  {
    id: 3,
    formName: 'Upward feedback - Maria Lopez',
    meta: 'H2 2026 review • about Maria Lopez • 10 questions',
    due: 'Nov 20, 2026',
    status: 'Submitted',
    tone: 'submitted',
    action: 'View answers',
  },
];

const reviewHighlights = [
  {
    title: 'Top strengths',
    icon: TrendingUp,
    items: [
      'Clear ownership and follow-through',
      'Helpful communication with teammates',
      'Reliable delivery on committed work',
    ],
  },
  {
    title: 'Development focus',
    icon: Target,
    items: [
      'Share progress earlier when risks appear',
      'Delegate smaller tasks more confidently',
      'Make technical decisions easier to follow',
    ],
  },
];

export default function EmployeeReviewPreview() {
  return (
    <AppLayout activePage="employee-review-preview" pageClassName="employee-home-page">
      <div className="main-content employee-home-main employee-review-preview-main">
        <div className="topbar employee-topbar">
          <div className="employee-dashboard-heading">
            <div className="employee-kicker">Performance review</div>
            <h1>Dashboard</h1>
          </div>
        </div>

        <section className="card employee-review-panel active-review-panel">
          <div className="active-review-hero">
            <div className="active-review-icon" aria-hidden="true">
              <ClipboardList size={58} />
            </div>

            <div className="active-review-copy">
              <span className="employee-task-pill">H2 2026 review · Open</span>
              <h2>You have 2 open review tasks</h2>
              <p>Complete the forms assigned to you before the cycle closes. Your progress is saved automatically.</p>
              <div className="employee-next-cycle">
                <Calendar size={18} />
                <span>Cycle closes:</span>
                <strong>November 30, 2026</strong>
              </div>
            </div>

            <div className="active-review-progress-card">
              <span>Submitted</span>
              <strong>1 / 3</strong>
              <div className="employee-progress-line">
                <span style={{ width: '33%' }} />
              </div>
              <small>33% complete</small>
            </div>
          </div>

          <div className="active-work-header">
            <div>
              <h3>Assigned work</h3>
              <p>Start with the task in progress, then complete the remaining requests.</p>
            </div>
            <button className="active-help-button" type="button">
              <MessageCircle size={15} />
              Have a question for HR?
            </button>
          </div>

          <div className="employee-work-table active-work-list">
            {previewTasks.map((task) => (
              <div className={`employee-work-row active-work-row ${task.tone}`} key={task.id}>
                <div className="employee-work-icon" aria-hidden="true">
                  <ClipboardCheck size={17} />
                </div>
                <div className="employee-work-task">
                  <strong>{task.formName}</strong>
                  <span>{task.meta}</span>
                </div>
                <div className="employee-work-due">
                  <span>Due</span>
                  <strong>{task.due}</strong>
                </div>
                <span className={`employee-status ${task.tone}`}>{task.status}</span>
                <button className={task.tone === 'progress' ? 'btn btn-primary employee-row-action' : 'btn btn-secondary employee-row-action'} type="button">
                  {task.action}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="employee-results-section employee-preview-results">
          <div className="employee-section-row">
            <div className="employee-section-title">
              <div className="employee-kicker">Previous results</div>
              <h2>Latest published review highlights</h2>
              <p>A quick reminder of insights from your most recent review.</p>
            </div>
            <div className="employee-results-actions">
              <span>Q1 2024</span>
              <Link to="/results">Open full results</Link>
            </div>
          </div>

          <div className="employee-highlights-grid">
            {reviewHighlights.map((highlight) => {
              const Icon = highlight.icon;
              return (
                <div className="card employee-highlight-card" key={highlight.title}>
                  <h3>
                    <Icon size={21} />
                    {highlight.title}
                  </h3>
                  <ol>
                    {highlight.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
