import type { FormEvent } from 'react';
import type {
  Campaign,
  CampaignFormValues,
  UpdateCampaignField,
} from '../campaign.types';
import { getEndDateMin, isCampaignStarted } from '../campaign.utils';
type Props = {
  form: CampaignFormValues;
  campaign?: Campaign;
  createdByName?: string;
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
  createdByName = 'User',
  message,
  isSaving,
  hasChanges = true,
  updateForm,
  onSubmit,
  onCancel,
}: Props) {
  return (
    <form className="campaign-create-form" onSubmit={onSubmit}>
      <label className="form-field campaign-field-wide">
        <span className="form-label">Campaign name *</span>
        <input
          className="form-control"
          required
          value={form.name}
          onChange={(event) => updateForm('name', event.target.value)}
          placeholder={campaign ? undefined : 'e.g. Winter 2027 review'}
        />
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
        <span className="form-label">Start date *</span>
        <input
          className="form-control"
          required
          type="date"
          value={form.startDate}
          disabled={campaign ? isCampaignStarted(campaign) : false}
          onChange={(event) => updateForm('startDate', event.target.value)}
        />
      </label>

      <label className="form-field">
        <span className="form-label">End date</span>
        <input
          className="form-control"
          type="date"
          value={form.endDate}
          min={campaign ? getEndDateMin(form, campaign) : form.startDate}
          onChange={(event) => updateForm('endDate', event.target.value)}
        />
      </label>

      <label className="form-field">
        <span className="form-label">Status</span>
        <select
          className="form-control"
          value={form.isActive ? 'active' : 'closed'}
          onChange={(event) =>
            updateForm('isActive', event.target.value === 'active')
          }
        >
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
      </label>

      {!campaign && (
        <label className="form-field">
          <span className="form-label">Created by</span>
          <input className="form-control" value={createdByName} disabled />
        </label>
      )}

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

      <div className="campaign-form-summary">
        <strong>{campaign ? 'Date rules' : 'Next step'}</strong>
        <span>
          {campaign
            ? 'The start date is locked after the campaign starts. The end date cannot be before the start date, and cannot be moved earlier after questionnaires are issued.'
            : 'After creating the campaign you can open it and attach forms, company groups, and evaluation rules.'}
        </span>
      </div>

      {message !== '' && <div className="campaign-save-message">{message}</div>}

      <div className="campaign-modal-actions">
        <button className="btn btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={hasChanges ? 'btn btn-primary' : 'btn btn-secondary'}
          type="submit"
          disabled={isSaving || !hasChanges}
        >
          {isSaving ? 'Saving...' : campaign ? 'Save changes' : 'Save campaign'}
        </button>
      </div>
    </form>
  );
}
