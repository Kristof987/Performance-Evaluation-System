import './DashboardTopbar.css';
import { getFullDate, getTimeOfDay } from '../utils/hrHome.utils';

type DashboardTopbarProps = {
  userName: string;
};

function DashboardTopbar({ userName }: DashboardTopbarProps) {
  return (
    <div className="topbar">
      <div className="greeting">
        <div className="greeting-title">
          Good {getTimeOfDay()}, {userName}
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
  );
}

export default DashboardTopbar;
