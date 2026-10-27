import type { ReportSectionScore } from '../types/reports.types';
import { Link } from 'react-router';
import ReportsEmptyState from './ReportsEmptyState';

export default function SectionScoresChart({ sections, sectionPath }: { sections: ReportSectionScore[]; sectionPath?: (id: number) => string }) {
  return <section className="reports-card reports-chart-card">
    <div className="reports-section-heading"><h2>Performance by Section</h2><p>Normalized peer scores on a common 1–5 scale. Each evaluated employee contributes equally.</p></div>
    {sections.length === 0 ? <ReportsEmptyState title="No Section scores available." message="Submitted numerical ratings inside questionnaire Sections are needed for performance results." /> :
      <div className="reports-dimension-chart" role="list">{sections.map((section) => {
        const available = section.availability === 'available' && section.average_score !== null;
        const description = available
          ? `${section.evaluatee_count} employees · ${section.evaluator_count} peer evaluators · 1–5 scale`
          : section.availability === 'suppressed' ? 'Unavailable due to confidentiality requirements' : 'No scored peer ratings';
        return <div className="reports-bar-row" key={section.id} role="listitem">
          <div className="reports-bar-label">{sectionPath ? <Link to={sectionPath(section.id)}>{section.name}</Link> : <strong>{section.name}</strong>}<span>{description}</span></div>
          <div className="reports-bar-track" aria-label={`${section.name}: ${available ? `${section.average_score!.toFixed(2)} out of 5` : description}`}>{available && <span style={{ width: `${(section.average_score! / 5) * 100}%` }} />}</div>
          <strong className="reports-bar-value">{available ? section.average_score!.toFixed(2) : section.availability === 'suppressed' ? 'Suppressed' : 'No data'}</strong>
        </div>;
      })}</div>}
  </section>;
}
