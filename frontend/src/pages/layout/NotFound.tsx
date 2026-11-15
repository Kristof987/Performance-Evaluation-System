import { Link, Navigate, useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';
import { getAuthenticatedDashboardPath } from './sidebar-user';
import AppLayout from './AppLayout';
import './auth0-transition.css';

/** Shown for any URL that matches no route (typos, removed pages, broken links). */
export default function NotFound() {
  const { state } = useAppAuth();
  const location = useLocation();
  if (state.status === 'loading') return <main role="status">Checking your PerfEval account...</main>;
  if (state.status !== 'authenticated') {
    return <Navigate to="/" state={{ from: location.pathname + location.search + location.hash }} replace />;
  }
  const dashboard = getAuthenticatedDashboardPath(state.user.permissions);
  return <AppLayout activePage={dashboard === '/hr-home' ? 'hr-home' : 'employee-home'} pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>Page not found</h1>
      <section className="card auth0-transition-card">
        <p>There is no page at <code>{location.pathname}</code>. The link may be mistyped, or the page may have moved.</p>
        <Link className="btn btn-primary" to={dashboard} replace>Back to dashboard</Link>
      </section>
    </div>
  </AppLayout>;
}
