import AppLayout from '../layout/AppLayout';
import MyEvaluationsPanel from './components/MyEvaluationsPanel';
import './hr-home.css';

export default function MyEvaluationsPage() {
  return <AppLayout activePage="my-evaluations" pageClassName="hr-home-page">
    <main className="main-content my-evaluations-main">
      <header className="my-evaluations-page-heading"><h1>My Evaluations</h1><p>Complete your assigned questionnaires and view submitted evaluations.</p></header>
      <MyEvaluationsPanel />
    </main>
  </AppLayout>;
}
