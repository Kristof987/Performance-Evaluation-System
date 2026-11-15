import { Link, useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';
import { getAuthenticatedDashboardPath } from './sidebar-user';
import AppLayout from './AppLayout';
import type { SidebarPage } from './Sidebar';
import './auth0-transition.css';

/** Shown when a signed-in user lacks a permission the page needs (rules in app/access.ts). */
export function Auth0PermissionDenied({ feature, required, activePage }: {
  feature: string;
  required: string;
  activePage: SidebarPage;
}) {
  const { state } = useAppAuth();
  const { pathname } = useLocation();
  const dashboardPath = getAuthenticatedDashboardPath(state.status === 'authenticated' ? state.user.permissions : []);
  return <AppLayout activePage={activePage} pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>{feature} access unavailable</h1>
      <section className="card auth0-transition-card">
        <p>Your PerfEval account needs {required} permission to view this page.</p>
        {dashboardPath !== pathname && <Link className="btn btn-primary" to={dashboardPath}>Back to Dashboard</Link>}
      </section>
    </div>
  </AppLayout>;
}
