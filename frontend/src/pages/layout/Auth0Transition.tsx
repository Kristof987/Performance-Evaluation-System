import { Link, useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';
import { getSystemDashboardPath } from './sidebar-user';
import AppLayout from './AppLayout';
import type { SidebarPage } from './Sidebar';
import './auth0-transition.css';

function useAuth0Identity() {
  const { state } = useAppAuth();
  if (state.status !== 'authenticated' || state.mode !== 'auth0') {
    throw new Error('A linked Auth0 identity is required');
  }
  return state.user;
}

export function Auth0Dashboard() {
  const user = useAuth0Identity();
  const isHr = getSystemDashboardPath(user.system_role_name) === '/hr-home';
  const heading = user.system_role_name.trim().toLowerCase() === 'hr'
    ? 'HR Dashboard' : isHr ? 'Manager Dashboard' : 'Employee Dashboard';
  return (
    <AppLayout activePage={isHr ? 'hr-home' : 'employee-home'} pageClassName="auth0-transition-page">
      <div className="main-content auth0-transition-content">
        <h1>{heading}</h1>
        <p>Welcome, {user.employee.full_name}. Your Auth0 identity is linked to your PerfEval account.</p>
        <p>System role: {user.system_role_name}. Company role: {user.employee.company_role_name}. Dashboard navigation follows your system role.</p>
        <section className="card auth0-transition-card" aria-label="Dashboard availability">
          <h2>Dashboard data is not available yet</h2>
          <p>Campaigns, evaluations, people, forms, reports, results and settings still use business APIs that have not been migrated to Auth0 authorization. They are unavailable in Auth0 mode until the backend validates access tokens and derives the acting user on each request.</p>
        </section>
      </div>
    </AppLayout>
  );
}

export function Auth0Unavailable() {
  const user = useAuth0Identity();
  const { pathname } = useLocation();
  const dashboardPath = getSystemDashboardPath(user.system_role_name);
  const isHr = dashboardPath === '/hr-home';
  let activePage: SidebarPage = isHr ? 'hr-home' : 'employee-home';
  if (pathname.startsWith('/people')) activePage = 'people';
  else if (pathname.startsWith('/campaigns')) activePage = 'campaigns';
  else if (pathname.startsWith('/forms')) activePage = 'forms';
  else if (pathname.startsWith('/reports')) activePage = 'reports';
  else if (pathname.startsWith('/results')) activePage = 'results';
  else if (pathname.startsWith('/settings')) activePage = 'settings';
  else if (pathname.startsWith('/my-evaluations')) activePage = 'my-evaluations';

  return (
    <AppLayout activePage={activePage} pageClassName="auth0-transition-page">
      <div className="main-content auth0-transition-content">
        <h1>Feature unavailable in Auth0 mode</h1>
        <section className="card auth0-transition-card">
          <p>This page depends on business APIs that still accept client-selected identities. It will become available after those endpoints use your validated Auth0 identity for authorization.</p>
          <Link className="btn btn-primary" to={dashboardPath}>Back to Dashboard</Link>
        </section>
      </div>
    </AppLayout>
  );
}
