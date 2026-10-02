import type { ReactNode } from 'react';
import AppLayout from '../../layout/AppLayout';
import '../campaigns.css';
export default function CampaignPage({ children }: { children: ReactNode }) {
  return (
    <AppLayout activePage="campaigns" pageClassName="campaign-page">
      <div className="main-content campaign-content">{children}</div>
    </AppLayout>
  );
}
