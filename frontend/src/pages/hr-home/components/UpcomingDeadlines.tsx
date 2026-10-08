import './UpcomingDeadlines.css';
import type { DashboardUpcomingDeadline } from '../hrHome.types';
import { formatShortDate } from '../utils/hrHome.utils';

type UpcomingDeadlinesProps = {
  deadlines: DashboardUpcomingDeadline[];
};

function UpcomingDeadlines({ deadlines }: UpcomingDeadlinesProps) {
  return (
    <div className="upcoming-section">
      <div className="section-header">
        <div className="section-title">Upcoming deadlines</div>
      </div>
      <div className="upcoming-list">
        {deadlines.length === 0 && (
          <div className="upcoming-item">
            <div className="upcoming-name">No upcoming deadlines</div>
            <div className="upcoming-meta">
              Campaign start and end dates will show here.
            </div>
          </div>
        )}
        {deadlines.map((deadline) => (
          <div
            className="upcoming-item"
            key={`${deadline.campaign_id}:${deadline.deadline_type}`}
          >
            <div className="upcoming-date">{formatShortDate(deadline.date)}</div>
            <div className="upcoming-name">{deadline.name}</div>
            <div className="upcoming-meta">
              Campaign {deadline.deadline_type.toLowerCase()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default UpcomingDeadlines;
