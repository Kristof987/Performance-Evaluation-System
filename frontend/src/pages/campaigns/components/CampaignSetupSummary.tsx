import { ChevronRight, FileText, GitFork, Settings2, UserRound, UsersRound } from 'lucide-react';

export type SetupSummaryItem = {
  section: 'groups' | 'pairs' | 'questionnaires' | 'self';
  title: string;
  value: string;
  description: string;
  status: string;
  tone: 'complete' | 'incomplete' | 'optional' | 'neutral';
};

const icons = { groups: UsersRound, pairs: GitFork, questionnaires: FileText, self: UserRound };

export default function CampaignSetupSummary({ items, onOpen }: {
  items: SetupSummaryItem[];
  onOpen: (section: SetupSummaryItem['section']) => void;
}) {
  return <section className="campaign-setup-summary" aria-labelledby="campaign-setup-summary-title">
    <div className="campaign-setup-summary-heading">
      <span className="campaign-dashboard-icon campaign-dashboard-icon-blue"><Settings2 size={19} aria-hidden="true" /></span>
      <div><h2 id="campaign-setup-summary-title">Setup summary</h2><p>Key configuration details for this campaign. Open a section to make changes.</p></div>
    </div>
    <div className="campaign-setup-summary-grid">{items.map((item) => {
      const Icon = icons[item.section];
      return <button key={item.section} type="button" className={`campaign-setup-mini-card campaign-setup-mini-${item.section}`} onClick={() => onOpen(item.section)} aria-label={`${item.title}: ${item.value}. ${item.status}. Open setup section`}>
        <span className="campaign-setup-mini-top"><span className="campaign-setup-mini-icon"><Icon size={20} aria-hidden="true" /></span><span className={`campaign-setup-mini-status campaign-setup-mini-status-${item.tone}`}>{item.status}</span></span>
        <span className="campaign-setup-mini-title">{item.title}</span>
        <span className="campaign-setup-mini-value">{item.value}<ChevronRight size={16} aria-hidden="true" /></span>
        <span className="campaign-setup-mini-description" title={item.description}>{item.description}</span>
      </button>;
    })}</div>
  </section>;
}
