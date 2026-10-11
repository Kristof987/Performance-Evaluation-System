import CampaignPage from './components/CampaignPage';
import CampaignList from './components/CampaignList';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import { useCampaigns } from './hooks/useCampaigns';
export { CampaignDetails } from './CampaignDetails';
export function Campaigns() {
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
            <button
              className="btn btn-primary"
              type="button"
              onClick={state.openCreate}
            >
              Create campaign
            </button>
          </div>
        </div>
        {state.successMessage !== '' && (
          <div className="campaign-success-message">{state.successMessage}</div>
        )}
        <CampaignStats campaignList={state.campaignList} />
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
