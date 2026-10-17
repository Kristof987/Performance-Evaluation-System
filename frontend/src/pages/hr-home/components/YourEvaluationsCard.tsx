import { Link } from 'react-router';
import { dashboardWork } from '../../employee-home/employee-home.utils';
import { formatShortDate } from '../utils/hrHome.utils';
import { useMyEvaluations } from '../hooks/useMyEvaluations';
import './YourEvaluationsCard.css';

export default function YourEvaluationsCard() {
  const { evaluations, loading, error } = useMyEvaluations();
  if (loading || error) return null;
  const { actionable, nextDeadline } = dashboardWork(evaluations);
  if (actionable.length === 0) return null;

  return <section className="card your-evaluations-card" aria-labelledby="your-evaluations-heading">
    <div className="your-evaluations-summary">
      <h2 id="your-evaluations-heading">Your evaluations</h2>
      <p>Personal questionnaires across all campaigns</p>
    </div>
    <div className="your-evaluations-count"><strong>{actionable.length}</strong><span>to complete</span></div>
    <div className="your-evaluations-due"><span>Nearest due date</span><strong>{nextDeadline ? formatShortDate(nextDeadline.dueDate) : 'No deadline'}</strong></div>
    <Link className="btn btn-primary" to="/my-evaluations">View my evaluations</Link>
  </section>;
}
