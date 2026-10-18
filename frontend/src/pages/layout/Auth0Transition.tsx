import { Link, useLocation } from 'react-router';
import { useAppAuth } from '../../auth/AppAuth';
import { getAuthenticatedDashboardPath } from './sidebar-user';
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

export function Auth0Unavailable() {
  const user = useAuth0Identity();
  const { pathname } = useLocation();
  const dashboardPath = getAuthenticatedDashboardPath(user.permissions);
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

export function Auth0PermissionDenied({ feature = 'People', required = 'employees.read and groups.read', activePage = 'people' }: {
  feature?: string;
  required?: string;
  activePage?: SidebarPage;
}) {
  const user = useAuth0Identity();
  const { pathname } = useLocation();
  const dashboardPath = getAuthenticatedDashboardPath(user.permissions);
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

export function Auth0PersonalResultsUnavailable() {
  return <AppLayout activePage="results" pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>Personal results are not available yet</h1>
      <section className="card auth0-transition-card">
        <p>The current Results page uses sample data. PerfEval does not yet have a defined publication rule or a separate authorized API for employees to view their own results.</p>
      </section>
    </div>
  </AppLayout>;
}

export function DevelopmentPeopleUnavailable() {
  return <AppLayout activePage="people" pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>People requires Auth0 sign-in</h1>
      <section className="card auth0-transition-card">
        <p>The development identity selector is not a credential. People and Groups now require a linked Auth0 account with database-granted permissions.</p>
      </section>
    </div>
  </AppLayout>;
}

export function DevelopmentManagementUnavailable() {
  const { pathname } = useLocation();
  const isForms = pathname === '/forms';
  return <AppLayout activePage={isForms ? 'forms' : 'campaigns'} pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>{isForms ? 'Forms' : 'Campaigns'} requires Auth0 sign-in</h1>
      <section className="card auth0-transition-card">
        <p>The development identity selector is not a credential. This module requires a linked Auth0 account with database-granted permissions.</p>
      </section>
    </div>
  </AppLayout>;
}

export function DevelopmentEvaluationUnavailable() {
  return <AppLayout activePage="employee-home" pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>Evaluations require Auth0 sign-in</h1>
      <section className="card auth0-transition-card">
        <p>The development identity selector cannot access assigned questionnaires. Sign in with a linked Auth0 account to view and submit your own evaluations.</p>
      </section>
    </div>
  </AppLayout>;
}

export function DevelopmentDashboardUnavailable() {
  return <AppLayout activePage="hr-home" pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>Dashboard requires Auth0 sign-in</h1>
      <section className="card auth0-transition-card">
        <p>Campaign progress and employee completion metadata require a linked Auth0 account with campaigns.read permission. The development identity selector cannot access this Dashboard.</p>
      </section>
    </div>
  </AppLayout>;
}

export function DevelopmentReportsUnavailable() {
  return <AppLayout activePage="reports" pageClassName="auth0-transition-page">
    <div className="main-content auth0-transition-content">
      <h1>Reports require Auth0 sign-in</h1>
      <section className="card auth0-transition-card">
        <p>Performance results require a linked Auth0 account with reports.read permission. The development identity selector cannot access these reports.</p>
      </section>
    </div>
  </AppLayout>;
}
