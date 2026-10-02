import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import './styles/index.css'
import Login from './pages/login/Login'
import HrHome from './pages/hr-home/HrHome'
import People from './pages/people/People'
import Forms from './pages/forms/Forms'
import { CampaignDetails, Campaigns } from './pages/campaigns/Campaigns'
import './styles/shared.css'

function RequireLoggedInUser({ children }: { children: React.ReactNode }) {
  const loggedInUser = sessionStorage.getItem('loggedInUser')

  if (!loggedInUser) {
    return <Navigate to="/" replace />
  }

  return children
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/hr-home" element={<RequireLoggedInUser><HrHome /></RequireLoggedInUser>} />
        <Route path="/people" element={<People />} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetails />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
