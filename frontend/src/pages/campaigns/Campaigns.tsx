import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useToast } from '../../components/feedback/feedback-context';
import CampaignPage from './components/CampaignPage';
import CampaignList from './components/CampaignList';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import { useCampaigns } from './hooks/useCampaigns';
export { CampaignDetails } from './CampaignDetails';
export function Campaigns() {
  const location = useLocation();
  const state = useCampaigns();
  const navigate = useNavigate();
  const toast = useToast();
  const campaignDeleted = (location.state as { campaignDeleted?: string } | null)?.campaignDeleted;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!campaignDeleted || announced.current === location.key) return;
    announced.current = location.key;
    toast.success(`“${campaignDeleted}” permanently deleted`);
    // Clear the flag so a reload or Back doesn't show it again.
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [campaignDeleted, toast, navigate, location.key, location.pathname, location.search]);
  return (
    <CampaignPage>
      <div className="campaign-view">
        <div className="campaign-heading">
          <div>
            <h1>Campaigns</h1>
             <p>Create and manage performance review campaigns.</p>
          </div>
          <div className="campaign-heading-actions">
            {state.canManageCampaigns && <button
              className="btn btn-primary"
              type="button"
              onClick={state.openCreate}
            >
               Create draft
            </button>}
          </div>
        </div>
        <CampaignStats campaignList={state.summaryCampaigns} archived={state.statusFilter === 'Archived'} />
        <CampaignList
          campaignList={state.campaignList}
          filteredCampaigns={state.filteredCampaigns}
          searchQuery={state.searchQuery}
          statusFilter={state.statusFilter}
          isCampaignsLoading={state.isCampaignsLoading}
          campaignsError={state.campaignsError}
          setSearchQuery={state.setSearchQuery}
          setStatusFilter={state.setStatusFilter}
        />
      </div>
      {state.isCreateOpen && (
        <CampaignModal mode="create" onClose={state.closeCreate}>
          <CampaignForm
            form={state.form}
            message={state.createMessage}
            isSaving={state.isSavingCampaign}
            updateForm={state.updateForm}
            onSubmit={state.handleCreateCampaign}
            onCancel={state.closeCreate}
          />
        </CampaignModal>
      )}
    </CampaignPage>
  );
}
export default Campaigns;
