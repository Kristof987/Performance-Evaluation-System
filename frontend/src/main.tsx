import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Auth0Provider } from '@auth0/auth0-react'
import './styles/index.css'
import Login from './pages/login/Login'
import HrHome from './pages/hr-home/HrHome'
import MyEvaluationsPage from './pages/hr-home/MyEvaluationsPage'
import EmployeeHome from './pages/employee-home/EmployeeHome'
import EmployeeQuestionnaire from './pages/employee-home/EmployeeQuestionnaire'
import EmployeeReviewPreview from './pages/employee-home/EmployeeReviewPreview'
import EmployeeResults from './pages/employee-results/EmployeeResults'
import People from './pages/people/People'
import Forms from './pages/forms/Forms'
import { CampaignDetails, Campaigns } from './pages/campaigns/Campaigns'
import CompletionStatus from './pages/completion-status/CompletionStatus'
import CampaignOverviewPage, { ReportsIndexPage } from './pages/reports/CampaignOverviewPage'
import DetailedResultsPage from './pages/reports/DetailedResultsPage'
import AIAnalysisPage from './pages/reports/AIAnalysisPage'
import QuestionAnalyticsPage from './pages/reports/QuestionAnalyticsPage'
import { GroupDetailPage, GroupsRolesPage, RoleDetailPage } from './pages/reports/GroupsRolesPage'
import { EmployeeReportDetailPage, EmployeeReportsPage } from './pages/reports/EmployeeReportsPage'
import SettingsPage from './pages/settings/SettingsPage'
import './styles/shared.css'
import { getDashboardPath, getAuthenticatedDashboardPath, isHrOrManagerRole } from './pages/layout/sidebar-user'
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_CONFIGURED, AUTH0_DOMAIN } from './config'
import { Auth0AppAuthProvider, DevelopmentAppAuthProvider, useAppAuth } from './auth/AppAuth'
import { Auth0Unavailable, Auth0PersonalResultsUnavailable, DevelopmentPeopleUnavailable, DevelopmentManagementUnavailable, DevelopmentEvaluationUnavailable, DevelopmentDashboardUnavailable, DevelopmentReportsUnavailable, Auth0PermissionDenied } from './pages/layout/Auth0Transition'

function RoleHome() {
  return getDashboardPath() === '/hr-home' ? <HrHome /> : <EmployeeHome />
}

function ProtectedPage({ children, hrOnly = false }: {
  children: React.ReactNode;
  hrOnly?: boolean;
}) {
  const { state } = useAppAuth()
  const location = useLocation()
  if (state.status === 'loading') return <main role="status">Checking your PerfEval account...</main>
  if (state.status !== 'authenticated') {
    return <Navigate to="/" state={{ from: location.pathname + location.search + location.hash }} replace />
  }
  if (state.mode === 'auth0') {
    const canReadCampaigns = state.user.permissions.includes('campaigns.read')
    if (location.pathname === '/hr-home') {
      return canReadCampaigns ? <HrHome /> : <Navigate to="/employee-home" replace />
    }
    if (location.pathname === '/employee-home' && canReadCampaigns) {
      return <Navigate to="/hr-home" replace />
    }
    if (location.pathname === '/people') {
      if (!state.user.permissions.includes('employees.read') || !state.user.permissions.includes('groups.read')) {
        return <Auth0PermissionDenied />
      }
      return children
    }
    if (location.pathname === '/campaigns' || (location.pathname.startsWith('/campaigns/') && !location.pathname.endsWith('/completion'))) {
      return state.user.permissions.includes('campaigns.read')
        ? children : <Auth0PermissionDenied feature="Campaigns" required="campaigns.read" activePage="campaigns" />
    }
    if (location.pathname === '/forms') {
      return state.user.permissions.includes('forms.read') && state.user.permissions.includes('sections.read')
        ? children : <Auth0PermissionDenied feature="Forms" required="forms.read and sections.read" activePage="forms" />
    }
    if (location.pathname.startsWith('/campaigns/') && location.pathname.endsWith('/completion')) {
      return canReadCampaigns ? children
        : <Auth0PermissionDenied feature="Completion status" required="campaigns.read" activePage="campaigns" />
    }
    if (location.pathname === '/reports' || location.pathname.startsWith('/reports/')) {
      return state.user.permissions.includes('reports.read') ? children
        : <Auth0PermissionDenied feature="Reports" required="reports.read" activePage="reports" />
    }
    if (location.pathname === '/results' || location.pathname === '/employee-review-preview') {
      return <Auth0PersonalResultsUnavailable />
    }
    if (location.pathname === '/my-evaluations' || location.pathname === '/employee-home'
      || location.pathname.startsWith('/employee-home/evaluations/') || location.pathname.startsWith('/evaluations/')) {
      return state.user.permissions.includes('evaluations.read_assigned')
        ? children : <Auth0PermissionDenied feature="Evaluations" required="evaluations.read_assigned" activePage="my-evaluations" />
    }
    if (hrOnly && !canReadCampaigns) return <Navigate to={getAuthenticatedDashboardPath(state.user.permissions)} replace />
    return <Auth0Unavailable />
  }
  if (location.pathname === '/hr-home') return <DevelopmentDashboardUnavailable />
  if (location.pathname === '/reports' || location.pathname.startsWith('/reports/')) return <DevelopmentReportsUnavailable />
  if (location.pathname === '/people') return <DevelopmentPeopleUnavailable />
  if (location.pathname === '/forms' || location.pathname === '/campaigns' || location.pathname.startsWith('/campaigns/')) {
    return <DevelopmentManagementUnavailable />
  }
  if (location.pathname === '/my-evaluations' || location.pathname === '/employee-home'
    || location.pathname.startsWith('/employee-home/evaluations/') || location.pathname.startsWith('/evaluations/')) {
    return <DevelopmentEvaluationUnavailable />
  }
  if (location.pathname === '/my-evaluations' && !isHrOrManagerRole(state.user.role_name)) {
    return <Navigate to={getDashboardPath()} replace />
  }
  return children
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/hr-home" element={<ProtectedPage><RoleHome /></ProtectedPage>} />
        <Route path="/my-evaluations" element={<ProtectedPage hrOnly><MyEvaluationsPage /></ProtectedPage>} />
        <Route path="/employee-home" element={<ProtectedPage><EmployeeHome /></ProtectedPage>} />
        <Route path="/employee-home/evaluations/:id" element={<ProtectedPage><EmployeeQuestionnaire /></ProtectedPage>} />
        <Route path="/evaluations/:id" element={<ProtectedPage><EmployeeQuestionnaire /></ProtectedPage>} />
        <Route path="/employee-review-preview" element={<ProtectedPage><EmployeeReviewPreview /></ProtectedPage>} />
        <Route path="/results" element={<ProtectedPage><EmployeeResults /></ProtectedPage>} />
        <Route path="/people" element={<ProtectedPage hrOnly><People /></ProtectedPage>} />
        <Route path="/forms" element={<ProtectedPage hrOnly><Forms /></ProtectedPage>} />
        <Route path="/campaigns" element={<ProtectedPage hrOnly><Campaigns /></ProtectedPage>} />
        <Route path="/campaigns/:id" element={<ProtectedPage hrOnly><CampaignDetails /></ProtectedPage>} />
        <Route path="/campaigns/:id/completion" element={<ProtectedPage hrOnly><CompletionStatus /></ProtectedPage>} />
        <Route path="/reports" element={<ProtectedPage hrOnly><ReportsIndexPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId" element={<ProtectedPage hrOnly><CampaignOverviewPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/detailed" element={<ProtectedPage hrOnly><DetailedResultsPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/ai-analysis" element={<ProtectedPage hrOnly><AIAnalysisPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/questions" element={<ProtectedPage hrOnly><QuestionAnalyticsPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/groups" element={<ProtectedPage hrOnly><GroupsRolesPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/groups/:groupId" element={<ProtectedPage hrOnly><GroupDetailPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/roles" element={<ProtectedPage hrOnly><GroupsRolesPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/roles/:roleId" element={<ProtectedPage hrOnly><RoleDetailPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/employees" element={<ProtectedPage hrOnly><EmployeeReportsPage /></ProtectedPage>} />
        <Route path="/reports/campaigns/:campaignId/employees/:employeeId" element={<ProtectedPage hrOnly><EmployeeReportDetailPage /></ProtectedPage>} />
        <Route path="/settings" element={<ProtectedPage><Navigate to="/settings/profile" replace /></ProtectedPage>} />
        <Route path="/settings/:section" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AUTH0_CONFIGURED ? (
      <Auth0Provider
        domain={AUTH0_DOMAIN!}
        clientId={AUTH0_CLIENT_ID!}
        authorizationParams={{ redirect_uri: window.location.origin, audience: AUTH0_AUDIENCE }}
        cacheLocation="memory"
      >
        <Auth0AppAuthProvider><AppRoutes /></Auth0AppAuthProvider>
      </Auth0Provider>
    ) : <DevelopmentAppAuthProvider><AppRoutes /></DevelopmentAppAuthProvider>}
  </StrictMode>,
)
