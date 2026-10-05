import AppLayout from '../layout/AppLayout';
import { formatUserName, getSidebarUser } from '../layout/sidebar-user';
import './employee-home.css';

const assignedWork = [
  {
    title: 'Self-assessment form',
    meta: '18 questions • auto-saved 12 minutes ago',
    due: 'May 24',
    status: 'In progress',
    tone: 'progress',
    progress: 62,
  },
  {
    title: 'Peer feedback: Team Atlas',
    meta: 'Requested by campaign owner',
    due: 'May 26',
    status: 'Not started',
    tone: 'waiting',
    progress: 1,
  },
  {
    title: 'Manager conversation notes',
    meta: 'Available after your meeting',
    due: 'May 28',
    status: 'Scheduled',
    tone: 'scheduled',
    progress: 100,
  },
];

const activity = [
  ['Self-assessment draft saved', '12 minutes ago'],
  ['Peer feedback request received', 'Yesterday'],
  ['Mid-Year cycle opened', 'May 10'],
];

export default function EmployeeHome() {
  const user = getSidebarUser();
  const userName = user === null ? 'Employee' : formatUserName(user.username);

  return (
    <AppLayout activePage="employee-home" pageClassName="employee-home-page">
      <div className="main-content employee-home-main">
        <div className="topbar employee-topbar">
          <div className="greeting">
            <div className="greeting-title">Good morning, {userName}</div>
            <div className="greeting-date">
              You have 2 open review actions in the 2025 Mid-Year cycle.
            </div>
          </div>
          <div className="button-group">
            <button className="icon-button" type="button" aria-label="Notifications">
              <span />
            </button>
            <button className="icon-button" type="button" aria-label="More actions">
              <span />
            </button>
          </div>
        </div>

        <section className="card employee-cycle-card">
          <div className="employee-cycle-copy">
            <div className="employee-kicker">Current cycle</div>
            <h1>2025 Mid-Year Performance Review</h1>
            <p>
              Complete the forms assigned to you. Results become visible after manager approval.
            </p>
          </div>
          <div className="employee-cycle-metrics">
            <div className="employee-cycle-metric">
              <span>Self review</span>
              <strong>62%</strong>
              <small>In progress</small>
            </div>
            <div className="employee-cycle-metric warning">
              <span>Peer feedback</span>
              <strong>0/2</strong>
              <small>Waiting</small>
            </div>
            <div className="employee-cycle-metric muted">
              <span>Results</span>
              <strong>Locked</strong>
              <small>Not shared</small>
            </div>
          </div>
        </section>

        <div className="employee-section-row">
          <div className="employee-section-title">
            <h2>Assigned work</h2>
            <p>Only tasks that require your input are shown here.</p>
          </div>
          <div className="employee-filter-tabs" aria-label="Assigned work filter">
            <button className="active" type="button">Open</button>
            <button type="button">Submitted</button>
            <button type="button">All</button>
          </div>
        </div>

        <section className="employee-workspace">
          <div className="card employee-work-table">
            <div className="employee-work-header">
              <span>Task</span>
              <span>Due</span>
              <span>Status</span>
            </div>
            {assignedWork.map((task) => (
              <div className="employee-work-row" key={task.title}>
                <div className="employee-work-task">
                  <strong>{task.title}</strong>
                  <span>{task.meta}</span>
                  <div className={`employee-progress-line ${task.tone}`}>
                    <span style={{ width: `${task.progress}%` }} />
                  </div>
                </div>
                <strong className="employee-work-due">{task.due}</strong>
                <span className={`employee-status ${task.tone}`}>{task.status}</span>
              </div>
            ))}
          </div>

          <aside className="employee-side-stack">
            <div className="card employee-next-card">
              <div className="employee-kicker">Next step</div>
              <h2>Finish the self-assessment before Friday</h2>
              <p>You can submit once all required questions have an answer.</p>
              <button className="btn btn-primary" type="button">Continue form</button>
            </div>
            <div className="card employee-next-card">
              <h2>Results</h2>
              <p>Scores and comments are private to you and will appear here after the cycle is published.</p>
              <span className="employee-locked-pill">Locked until published</span>
            </div>
          </aside>
        </section>

        <section className="card employee-activity-card">
          <h2>Recent activity</h2>
          <div className="employee-activity-list">
            {activity.map(([label, time]) => (
              <div className="employee-activity-row" key={label}>
                <span className="employee-activity-dot" />
                <strong>{label}</strong>
                <span>{time}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
