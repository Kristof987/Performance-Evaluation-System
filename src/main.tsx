import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import './index.css'
import Login from './Login'
import HrHome from './hr-home'
import People from './people'
import Forms from './forms'
import { CampaignDetails, Campaigns } from './campaigns'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/hr-home" element={<HrHome />} />
        <Route path="/people" element={<People />} />
        <Route path="/forms" element={<Forms />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/campaigns/:id" element={<CampaignDetails />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
