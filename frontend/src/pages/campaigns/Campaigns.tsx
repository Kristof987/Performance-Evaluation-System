import { useLocation } from 'react-router';
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
        {state.successMessage !== '' && (
          <div className="campaign-success-message">{state.successMessage}</div>
        )}
        {(location.state as { campaignDeleted?: boolean } | null)?.campaignDeleted && (
          <div className="campaign-success-message" role="status">Campaign permanently deleted.</div>
        )}
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
