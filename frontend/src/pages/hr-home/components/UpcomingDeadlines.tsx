import './UpcomingDeadlines.css';
import { Flag, Play } from 'lucide-react';

import type { DashboardUpcomingDeadline } from '../hrHome.types';
import { formatRelativeDate, parseDateOnly } from '../utils/hrHome.utils';

type UpcomingDeadlinesProps = {
  deadlines: DashboardUpcomingDeadline[];
  onOpenCampaign: (campaignId: number) => void;
};

function formatTimelineMonth(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short' })
    .format(parseDateOnly(value))
    .toUpperCase();
}

function formatTimelineDay(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(
    parseDateOnly(value),
  );
}

function getDeadlineLabel(deadlineType: DashboardUpcomingDeadline['deadline_type']) {
  return deadlineType === 'Starts' ? 'Campaign starts' : 'Campaign ends';
}

function UpcomingDeadlines({ deadlines, onOpenCampaign }: UpcomingDeadlinesProps) {
  const visibleDeadlines = deadlines.slice(0, 4);

  return (
    <section className="upcoming-section" aria-labelledby="upcoming-title">
      <div className="section-header">
        <div className="section-title" id="upcoming-title">
          Upcoming deadlines
        </div>
      </div>
      <div className="card upcoming-timeline">
        {visibleDeadlines.length === 0 && (
          <div className="upcoming-empty">
            <strong>No upcoming campaign dates</strong>
            <span>Campaign start and end dates will show here.</span>
          </div>
        )}
        {visibleDeadlines.map((deadline) => (
          <button
            className="upcoming-timeline-item"
            key={`${deadline.campaign_id}:${deadline.deadline_type}:${deadline.date}`}
            type="button"
            onClick={() => onOpenCampaign(deadline.campaign_id)}
          >
            <span className="upcoming-date-block" aria-hidden="true">
              <span>{formatTimelineMonth(deadline.date)}</span>
              <strong>{formatTimelineDay(deadline.date)}</strong>
            </span>
            <span className="upcoming-event-main">
              <strong>{deadline.name}</strong>
              <span>
                {deadline.deadline_type === 'Starts' ? (
                  <Play size={12} aria-hidden="true" />
                ) : (
                  <Flag size={12} aria-hidden="true" />
                )}
                {getDeadlineLabel(deadline.deadline_type)}
              </span>
            </span>
            <span className="upcoming-relative">{formatRelativeDate(deadline.date)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default UpcomingDeadlines;
