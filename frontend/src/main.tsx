import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import { useEffect } from 'react'
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
import QuestionAnalyticsPage from './pages/reports/QuestionAnalyticsPage'
import { GroupDetailPage, GroupsRolesPage, RoleDetailPage } from './pages/reports/GroupsRolesPage'
import { EmployeeReportDetailPage, EmployeeReportsPage } from './pages/reports/EmployeeReportsPage'
import SettingsPage from './pages/settings/SettingsPage'
import './styles/shared.css'
import { getDashboardPath, getSidebarUser, isHrOrManagerRole } from './pages/layout/sidebar-user'
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_CONFIGURED, AUTH0_DOMAIN } from './config'

function Auth0SessionBoundary() {
  const { isAuthenticated, isLoading } = useAuth0()

  useEffect(() => {
    if (isAuthenticated) sessionStorage.removeItem('loggedInUser')
  }, [isAuthenticated])

  if (isLoading) return <main className="login-page"><p className="login-content">Checking Auth0 session...</p></main>
  return <AppRoutes auth0Authenticated={isAuthenticated} />
}

function RequireLoggedInUser({ children }: { children: React.ReactNode }) {
  const loggedInUser = sessionStorage.getItem('loggedInUser')

  if (!loggedInUser) {
    return <Navigate to="/" replace />
  }

  return children
}

function RoleHome() {
  return getDashboardPath() === '/hr-home' ? <HrHome /> : <EmployeeHome />
}

function RequireHrManager({ children }: { children: React.ReactNode }) {
  const user = getSidebarUser()
  if (!user) return <Navigate to="/" replace />
  return isHrOrManagerRole(user.role_name) ? children : <Navigate to={getDashboardPath()} replace />
}

function AppRoutes({ auth0Authenticated = false }: { auth0Authenticated?: boolean }) {
  return (
    <BrowserRouter>
      <Routes>
        {auth0Authenticated ? (
          <>
            <Route path="/" element={<Login />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
        <Route path="/" element={<Login />} />
        <Route path="/hr-home" element={<RequireLoggedInUser><RoleHome /></RequireLoggedInUser>} />
        <Route path="/my-evaluations" element={<RequireHrManager><MyEvaluationsPage /></RequireHrManager>} />
        <Route path="/employee-home" element={<RequireLoggedInUser><EmployeeHome /></RequireLoggedInUser>} />
        <Route path="/employee-home/evaluations/:id" element={<RequireLoggedInUser><EmployeeQuestionnaire /></RequireLoggedInUser>} />
        <Route path="/evaluations/:id" element={<RequireLoggedInUser><EmployeeQuestionnaire /></RequireLoggedInUser>} />
        <Route path="/employee-review-preview" element={<RequireLoggedInUser><EmployeeReviewPreview /></RequireLoggedInUser>} />
        <Route path="/results" element={<RequireLoggedInUser><EmployeeResults /></RequireLoggedInUser>} />
        <Route path="/people" element={<People />} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetails />} />
        <Route path="/campaigns/:id/completion" element={<RequireLoggedInUser><CompletionStatus /></RequireLoggedInUser>} />
        <Route path="/reports" element={<RequireLoggedInUser><ReportsIndexPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId" element={<RequireLoggedInUser><CampaignOverviewPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/questions" element={<RequireLoggedInUser><QuestionAnalyticsPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/groups" element={<RequireLoggedInUser><GroupsRolesPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/groups/:groupId" element={<RequireLoggedInUser><GroupDetailPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/roles" element={<RequireLoggedInUser><GroupsRolesPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/roles/:roleId" element={<RequireLoggedInUser><RoleDetailPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/employees" element={<RequireLoggedInUser><EmployeeReportsPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/employees/:employeeId" element={<RequireLoggedInUser><EmployeeReportDetailPage /></RequireLoggedInUser>} />
        <Route path="/settings" element={<RequireLoggedInUser><Navigate to="/settings/profile" replace /></RequireLoggedInUser>} />
        <Route path="/settings/:section" element={<RequireLoggedInUser><SettingsPage /></RequireLoggedInUser>} />
          </>
        )}
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
        <Auth0SessionBoundary />
      </Auth0Provider>
    ) : <AppRoutes />}
  </StrictMode>,
)
