import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './styles/index.css'
import Login from './pages/login/Login'
import HrHome from './pages/hr-home/HrHome'
import EmployeeHome from './pages/employee-home/EmployeeHome'
import EmployeeReviewPreview from './pages/employee-home/EmployeeReviewPreview'
import EmployeeResults from './pages/employee-results/EmployeeResults'
import People from './pages/people/People'
import Forms from './pages/forms/Forms'
import { CampaignDetails, Campaigns } from './pages/campaigns/Campaigns'
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
        <Route path="/employee-review-preview" element={<RequireLoggedInUser><EmployeeReviewPreview /></RequireLoggedInUser>} />
        <Route path="/results" element={<RequireLoggedInUser><EmployeeResults /></RequireLoggedInUser>} />
        <Route path="/people" element={<People />} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetails />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
