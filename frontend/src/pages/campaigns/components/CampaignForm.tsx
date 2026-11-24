import type { FormEvent } from 'react';
import InlineMessage from '../../../components/feedback/InlineMessage';
import Pending from '../../../components/feedback/Pending';
import type {
  Campaign,
  CampaignFormValues,
  UpdateCampaignField,
} from '../campaign.types';
type Props = {
  form: CampaignFormValues;
  campaign?: Campaign;
  message: string;
  isSaving: boolean;
  hasChanges?: boolean;
  updateForm: UpdateCampaignField;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
};
export default function CampaignForm({
  form,
  campaign,
  message,
  isSaving,
  hasChanges = true,
  updateForm,
  onSubmit,
  onCancel,
}: Props) {
  const nameConflict = message === 'A campaign with this name already exists.';
  return (
    <form className="campaign-create-form" onSubmit={onSubmit}>
      <label className="form-field campaign-field-wide">
        <span className="form-label">Campaign name *</span>
        <input
          className="form-control"
          required
          aria-invalid={nameConflict}
          aria-describedby={nameConflict ? 'campaign-name-error' : undefined}
          value={form.name}
          onChange={(event) => updateForm('name', event.target.value)}
          placeholder={campaign ? undefined : 'e.g. Winter 2027 review'}
        />
        {nameConflict && <span className="campaign-name-error" id="campaign-name-error" role="alert">{message}</span>}
      </label>

      <label className="form-field campaign-field-wide">
        <span className="form-label">Description</span>
        <textarea
          className="form-control"
          value={form.description}
          onChange={(event) => updateForm('description', event.target.value)}
          placeholder={
            campaign
              ? undefined
              : 'Short summary shown to HR admins and participants'
          }
          rows={3}
        />
      </label>

      <label className="form-field">
         <span className="form-label">Start date and time *</span>
        <input
          className="form-control"
          required
           type="datetime-local"
           step="60"
           value={form.startLocal}
           disabled={campaign ? campaign.status !== 'draft' && campaign.status !== 'scheduled' : false}
           onChange={(event) => updateForm('startLocal', event.target.value)}
        />
      </label>

      <label className="form-field">
         <span className="form-label">End date and time</span>
        <input
          className="form-control"
           type="datetime-local"
           step="60"
           value={form.endLocal}
           disabled={campaign ? campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'active' : false}
           min={form.startLocal}
           onChange={(event) => updateForm('endLocal', event.target.value)}
        />
        <span className="campaign-field-help">Budapest time (Europe/Budapest). Times skipped or repeated by daylight saving are not accepted.</span>
        {campaign?.status === 'active' && <span className="campaign-field-help">The campaign is running: the deadline can only be moved later. Filling ends at the deadline.</span>}
      </label>

      <label className="form-field campaign-field-wide">
        <span className="form-label">Internal comment</span>
        <textarea
          className="form-control"
          value={form.comment}
          onChange={(event) => updateForm('comment', event.target.value)}
          placeholder={campaign ? undefined : 'Optional HR-only note'}
          rows={3}
        />
      </label>

       {!campaign && <span className="campaign-form-guidance campaign-field-wide">New campaigns are saved as drafts. Configure groups and evaluations before scheduling.</span>}

      {message !== '' && !nameConflict && <InlineMessage tone="error" className="campaign-field-wide">{message}</InlineMessage>}

      <div className="campaign-modal-actions">
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={hasChanges ? 'btn btn-primary' : 'btn btn-secondary'}
          type="submit"
          disabled={isSaving || !hasChanges}
        >
           {isSaving ? <Pending label="Saving" /> : campaign ? 'Save changes' : 'Create draft'}
        </button>
      </div>
    </form>
  );
}
