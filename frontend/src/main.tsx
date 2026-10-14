import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './styles/index.css'
import Login from './pages/login/Login'
import HrHome from './pages/hr-home/HrHome'
import EmployeeHome from './pages/employee-home/EmployeeHome'
import EmployeeQuestionnaire from './pages/employee-home/EmployeeQuestionnaire'
import EmployeeReviewPreview from './pages/employee-home/EmployeeReviewPreview'
import EmployeeResults from './pages/employee-results/EmployeeResults'
import People from './pages/people/People'
import Forms from './pages/forms/Forms'
import { CampaignDetails, Campaigns } from './pages/campaigns/Campaigns'
import CompletionStatus from './pages/completion-status/CompletionStatus'
import CampaignOverviewPage, { ReportsIndexPage } from './pages/reports/CampaignOverviewPage'
import { GroupDetailPage, GroupsRolesPage, RoleDetailPage } from './pages/reports/GroupsRolesPage'
import { EmployeeReportDetailPage, EmployeeReportsPage } from './pages/reports/EmployeeReportsPage'
import SettingsPage from './pages/settings/SettingsPage'
import './styles/shared.css'
import { getDashboardPath } from './pages/layout/sidebar-user'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/hr-home" element={<RequireLoggedInUser><RoleHome /></RequireLoggedInUser>} />
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
        <Route path="/reports/campaigns/:campaignId/groups" element={<RequireLoggedInUser><GroupsRolesPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/groups/:groupId" element={<RequireLoggedInUser><GroupDetailPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/roles" element={<RequireLoggedInUser><GroupsRolesPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/roles/:roleId" element={<RequireLoggedInUser><RoleDetailPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/employees" element={<RequireLoggedInUser><EmployeeReportsPage /></RequireLoggedInUser>} />
        <Route path="/reports/campaigns/:campaignId/employees/:employeeId" element={<RequireLoggedInUser><EmployeeReportDetailPage /></RequireLoggedInUser>} />
        <Route path="/settings" element={<RequireLoggedInUser><Navigate to="/settings/profile" replace /></RequireLoggedInUser>} />
        <Route path="/settings/:section" element={<RequireLoggedInUser><SettingsPage /></RequireLoggedInUser>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
