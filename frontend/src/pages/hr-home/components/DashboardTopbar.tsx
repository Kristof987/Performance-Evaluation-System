import './DashboardTopbar.css';
import { Lightbulb } from 'lucide-react';
import { useState } from 'react';

import { hrInsightTips } from './hrInsights.data';
import { getTimeOfDay } from '../utils/hrHome.utils';
import { useDates } from '../../../app/dates';

type DashboardTopbarProps = {
  userName: string;
  currentDate: string | null;
};

function DashboardTopbar({ userName, currentDate }: DashboardTopbarProps) {
  const dates = useDates();
  const [tipIndex, setTipIndex] = useState(0);
  const activeTip = hrInsightTips[tipIndex];

  const nextTipHandler = () => {
    setTipIndex((currentIndex) => (currentIndex + 1) % hrInsightTips.length);
  };

  return (
    <div className="topbar">
      <div className="greeting">
        <div className="greeting-title">
          Good {getTimeOfDay()}, {userName}
        </div>
        <div className="greeting-date">{dates.day(currentDate, { weekday: true, month: 'long' }, '')}</div>
      </div>
      <aside className="hr-insights" aria-label="HR insights">
        <div className="hr-insights-heading">
          <div className="hr-insights-title">
            <span className="hr-insights-icon" aria-hidden="true">
              <Lightbulb size={14} />
            </span>
            <strong>HR Insights</strong>
          </div>
          <span>{activeTip.category}</span>
        </div>
        <div className="hr-insights-content">
          <strong>{activeTip.title}</strong>
          <p>{activeTip.description}</p>
        </div>
        <div className="hr-insights-footer">
          {activeTip.sourceLabel && activeTip.sourceUrl ? (
            <a href={activeTip.sourceUrl} target="_blank" rel="noopener noreferrer">{activeTip.sourceLabel}</a>
          ) : (
            <span>Curated HR practice</span>
          )}
          <button type="button" onClick={nextTipHandler}>
            Next tip →
          </button>
        </div>
      </aside>
    </div>
  );
}

export default DashboardTopbar;
