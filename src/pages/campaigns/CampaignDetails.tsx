import CampaignFormsTable from './components/CampaignFormsTable';
import { Link, useParams } from 'react-router';
import CampaignPage from './components/CampaignPage';
import CampaignStats from './components/CampaignStats';
import CampaignModal from './components/CampaignModal';
import CampaignForm from './components/CampaignForm';
import { useCampaignDetails } from './hooks/useCampaignDetails';
export function CampaignDetails() {
  const { id } = useParams();
  const {
    campaign,
    form,
    isEditOpen,
    isCampaignLoading,
    isSavingCampaign,
    campaignError,
    saveMessage,
    successMessage,
    hasEditChanges,
    openEdit,
    closeEdit,
    updateForm,
    handleUpdateCampaign,
  } = useCampaignDetails(id);
  if (isCampaignLoading) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <p>Loading campaign...</p>
        </div>
      </CampaignPage>
    );
  }

  if (campaign === null) {
    return (
      <CampaignPage>
        <div className="campaign-view">
          <p>{campaignError || 'Campaign not found.'}</p>
        </div>
      </CampaignPage>
    );
  }

  return (
    <CampaignPage>
      <div className="campaign-view">
        <div className="campaign-heading">
          <div>
            <Link to="/campaigns">{'<- All campaigns'}</Link>
            <h1>{campaign.name}</h1>
            <p>
              <span
                className={`badge ${
                  campaign.status === 'Active'
                    ? 'badge-success'
                    : 'badge-neutral'
                }`}
              >
                {campaign.status}
              </span>
              {campaign.start} - {campaign.end}
            </p>
          </div>
          <div className="campaign-heading-actions">
            <button
              className="btn btn-primary"
              type="button"
              onClick={openEdit}
            >
              Edit Campaign
            </button>
            <Link to="/hr-home">Back to dashboard</Link>
          </div>
        </div>

        {successMessage !== '' && (
          <div className="campaign-success-message">{successMessage}</div>
        )}

        <CampaignStats campaign={campaign} />
        <h2>Forms & assigned groups</h2>

        <CampaignFormsTable campaign={campaign} />

        <p className="campaign-sample-note">
          Campaign data loaded from the database.
          {campaign.status === 'Closed'
            ? ' This campaign is closed and read-only.'
            : ' Review assignments and deadlines within each form.'}
        </p>
      </div>

      {isEditOpen && (
        <CampaignModal
          mode="edit"
          issuedFormsCount={campaign.issuedFormsCount}
          onClose={closeEdit}
        >
          <CampaignForm
            form={form}
            campaign={campaign}
            message={saveMessage}
            isSaving={isSavingCampaign}
            hasChanges={hasEditChanges}
            updateForm={updateForm}
            onSubmit={handleUpdateCampaign}
            onCancel={closeEdit}
          />
        </CampaignModal>
      )}
    </CampaignPage>
  );
}

export default CampaignDetails;
