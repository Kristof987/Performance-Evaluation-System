import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import type { Campaign } from '../campaign.types';
import { useDates } from '../../../app/dates';

const day = 24 * 60 * 60 * 1000;

export default function CampaignTimeline({ campaign }: { campaign: Campaign }) {
  const dates = useDates();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const start = Date.parse(campaign.startAt);
  const end = campaign.endAt ? Date.parse(campaign.endAt) : null;
  const validStart = Number.isFinite(start);
  const validEnd = end !== null && Number.isFinite(end) && end > start;
  const closedAt = campaign.status === 'closed' && campaign.lastTransitionAt ? Date.parse(campaign.lastTransitionAt) : now;
  const markerTime = Number.isFinite(closedAt) ? closedAt : now;
  const elapsed = validStart && validEnd && end !== null ? Math.max(0, Math.min(100, (markerTime - start) * 100 / (end - start))) : 0;
  const daysUntilStart = validStart ? Math.ceil((start - now) / day) : 0;
  const daysRemaining = validEnd && end !== null ? Math.ceil((end - now) / day) : 0;
  const headline = campaign.status === 'closed' ? 'Campaign closed' : !validStart ? 'Dates unavailable' :
    now < start ? `Starts in ${daysUntilStart} ${daysUntilStart === 1 ? 'day' : 'days'}` :
      !validEnd ? end === null ? 'No deadline' : 'End date unavailable' : end !== null && now >= end ? 'Scheduled end passed' :
        `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining`;

  return <section className="campaign-timeline-card" aria-labelledby="campaign-timeline-title">
    <div className="campaign-dashboard-card-head">
      <span className="campaign-dashboard-icon campaign-dashboard-icon-blue"><CalendarDays size={19} aria-hidden="true" /></span>
      <h2 id="campaign-timeline-title">Campaign timeline</h2>
      <span className="campaign-timeline-remaining">{headline}</span>
    </div>
    <div className="campaign-timeline-visual" role="img" aria-label={`Campaign starts ${validStart ? dates.day(new Date(start).toISOString()) : 'at an unavailable date'}; ${validEnd && end !== null ? `scheduled end ${dates.day(new Date(end).toISOString())}` : 'no scheduled end'}; ${headline}`}>
      {validEnd && <span className={`campaign-timeline-marker-label${elapsed <= 5 ? ' at-start' : elapsed >= 95 ? ' at-end' : ''}`} style={{ left: `${elapsed}%` }}>{campaign.status === 'closed' ? 'Closed' : 'Now'}</span>}
      <div className="campaign-timeline-track"><span style={{ width: `${elapsed}%` }} /></div>
      {validEnd && <span className={`campaign-timeline-marker${elapsed <= 5 ? ' at-start' : elapsed >= 95 ? ' at-end' : ''}`} style={{ left: `${elapsed}%` }} />}
    </div>
    <div className="campaign-timeline-dates">
      <div><strong>{validStart ? dates.day(new Date(start).toISOString()) : 'Date unavailable'}</strong><span>Start date</span></div>
      <div><strong>{validEnd && end !== null ? dates.day(new Date(end).toISOString()) : end === null ? 'No deadline' : 'Date unavailable'}</strong><span>End date</span></div>
    </div>
  </section>;
}
