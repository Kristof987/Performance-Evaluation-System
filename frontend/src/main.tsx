import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import { Auth0Provider } from '@auth0/auth0-react'
import './styles/index.css'
import Login from './pages/login/Login'
import HrHome from './pages/hr-home/HrHome'
import MyEvaluationsPage from './pages/hr-home/MyEvaluationsPage'
import EmployeeHome from './pages/employee-home/EmployeeHome'
import EmployeeQuestionnaire from './pages/employee-home/EmployeeQuestionnaire'
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
import NotFound from './pages/layout/NotFound'
import './styles/shared.css'
import { ACCESS, hasAccess, type AccessRule } from './app/access'
import { PageTitle } from './app/usePageTitle'
import { AUTH0_AUDIENCE, AUTH0_CLIENT_ID, AUTH0_CONFIGURED, AUTH0_DOMAIN } from './config'
import { Auth0AppAuthProvider, DevelopmentAppAuthProvider, useAppAuth } from './auth/AppAuth'
import { Auth0PermissionDenied } from './pages/layout/Auth0Transition'
import PreferencesProvider from './pages/settings/PreferencesProvider'
import { applyTheme, cachedTheme } from './pages/settings/theme'

function EvaluationQualityRedirect() {
  const { campaignId } = useParams()
  return <Navigate to={`/reports/campaigns/${campaignId}`} replace />
}

/** Old questionnaire links (e.g. in bookmarks) keep working. */
function LegacyEvaluationRedirect() {
  const { id } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={`/evaluations/${id}${search}${hash}`} replace />
}

/** Requires a signed-in user and, when a rule is given, every permission it lists (see app/access.ts). */
function ProtectedPage({ rule, children }: { rule?: AccessRule; children: ReactNode }) {
  const { state } = useAppAuth()
  const location = useLocation()
  if (state.status === 'loading') return <main role="status">Checking your PerfEval account...</main>
  if (state.status !== 'authenticated') {
    return <Navigate to="/" state={{ from: location.pathname + location.search + location.hash }} replace />
  }
  if (rule && !hasAccess(state.user.permissions, rule)) {
    return <Auth0PermissionDenied feature={rule.feature} required={rule.permissions.join(' and ')} activePage={rule.activePage} />
  }
  return children
}

function HrHomeRoute() {
  const { state } = useAppAuth()
  const permissions = state.status === 'authenticated' ? state.user.permissions : []
  return hasAccess(permissions, ACCESS.campaigns) ? <HrHome /> : <Navigate to="/employee-home" replace />
}

function EmployeeHomeRoute() {
  const { state } = useAppAuth()
  const permissions = state.status === 'authenticated' ? state.user.permissions : []
  if (hasAccess(permissions, ACCESS.campaigns)) return <Navigate to="/hr-home" replace />
  return <ProtectedPage rule={ACCESS.evaluations}><EmployeeHome /></ProtectedPage>
}

/** IDs in the path (:id, :campaignId...) must be positive whole numbers; anything else is a broken link. */
function ValidIds({ children }: { children: ReactNode }) {
  const params = useParams()
  const invalid = Object.entries(params).some(([key, value]) => /id$/i.test(key) && !/^[1-9]\d{0,15}$/.test(value ?? ''))
  return invalid ? <NotFound /> : children
}

/** A route's tab title plus its access check. Pages that know a more specific name refine the title. */
function page(title: string[], element: ReactNode, rule?: AccessRule) {
  return <><PageTitle parts={title} /><ProtectedPage rule={rule}><ValidIds>{element}</ValidIds></ProtectedPage></>
}

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<><PageTitle parts={['Sign in']} /><Login /></>} />
        <Route path="/hr-home" element={page(['Dashboard'], <HrHomeRoute />)} />
        <Route path="/employee-home" element={page(['Dashboard'], <EmployeeHomeRoute />)} />
        <Route path="/my-evaluations" element={page(['My evaluations'], <MyEvaluationsPage />, ACCESS.evaluations)} />
        <Route path="/evaluations/:id" element={page(['Evaluation'], <EmployeeQuestionnaire />, ACCESS.evaluations)} />
        <Route path="/employee-home/evaluations/:id" element={<LegacyEvaluationRedirect />} />
        <Route path="/people" element={page(['People'], <People />, ACCESS.people)} />
        <Route path="/forms" element={page(['Forms'], <Forms />, ACCESS.forms)} />
        <Route path="/campaigns" element={page(['Campaigns'], <Campaigns />, ACCESS.campaigns)} />
        <Route path="/campaigns/:id" element={page(['Campaigns'], <CampaignDetails />, ACCESS.campaigns)} />
        <Route path="/campaigns/:id/completion" element={page(['Completion status', 'Campaigns'], <CompletionStatus />, ACCESS.completion)} />
        <Route path="/reports" element={page(['Reports'], <ReportsIndexPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId" element={page(['Overview', 'Reports'], <CampaignOverviewPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/detailed" element={page(['Detailed results', 'Reports'], <DetailedResultsPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/ai-analysis" element={page(['AI analysis', 'Reports'], <AIAnalysisPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/evaluation-quality" element={<EvaluationQualityRedirect />} />
        <Route path="/reports/campaigns/:campaignId/questions" element={page(['Question analytics', 'Reports'], <QuestionAnalyticsPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/groups" element={page(['Groups', 'Reports'], <GroupsRolesPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/groups/:groupId" element={page(['Group', 'Reports'], <GroupDetailPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/roles" element={page(['Roles', 'Reports'], <GroupsRolesPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/roles/:roleId" element={page(['Role', 'Reports'], <RoleDetailPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/employees" element={page(['Employees', 'Reports'], <EmployeeReportsPage />, ACCESS.reports)} />
        <Route path="/reports/campaigns/:campaignId/employees/:employeeId" element={page(['Employee', 'Reports'], <EmployeeReportDetailPage />, ACCESS.reports)} />
        <Route path="/settings" element={<Navigate to="/settings/profile" replace />} />
        <Route path="/settings/:section" element={page(['Settings'], <SettingsPage />, ACCESS.settings)} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}

applyTheme(cachedTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {AUTH0_CONFIGURED ? (
      <Auth0Provider
        domain={AUTH0_DOMAIN!}
        clientId={AUTH0_CLIENT_ID!}
        authorizationParams={{ redirect_uri: window.location.origin, audience: AUTH0_AUDIENCE }}
        cacheLocation="memory"
      >
        <Auth0AppAuthProvider><PreferencesProvider><AppRoutes /></PreferencesProvider></Auth0AppAuthProvider>
      </Auth0Provider>
    ) : <DevelopmentAppAuthProvider><PreferencesProvider><AppRoutes /></PreferencesProvider></DevelopmentAppAuthProvider>}
  </StrictMode>,
)
