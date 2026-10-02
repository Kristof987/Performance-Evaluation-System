import type {
  Campaign,
  CampaignResponse,
  CampaignFormValues,
} from './campaign.types';
export const emptyCampaignForm: CampaignFormValues = {
  name: '',
  description: '',
  startDate: '',
  endDate: '',
  isActive: true,
  comment: '',
};

export function formatDate(value: string) {
  if (!value) return 'No end date';

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

export function mapCampaignFromResponse(campaign: CampaignResponse): Campaign {
  return {
    id: campaign.id.toString(),
    name: campaign.name,
    status: campaign.is_active ? 'Active' : 'Closed',
    start: formatDate(campaign.start_date),
    end: formatDate(campaign.end_date ?? ''),
    startDate: campaign.start_date,
    endDate: campaign.end_date ?? '',
    description: campaign.description,
    comment: campaign.comment,
    issuedFormsCount: campaign.issued_forms_count ?? 0,
    sent: campaign.issued_forms_count ?? 0,
    done: 0,
    overdue: 0,
    forms: [],
  };
}

export function getCampaignForm(campaign: Campaign): CampaignFormValues {
  return {
    name: campaign.name,
    description: campaign.description ?? '',
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    isActive: campaign.status === 'Active',
    comment: campaign.comment ?? '',
  };
}

export function isCampaignStarted(campaign: Campaign) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return new Date(`${campaign.startDate}T00:00:00`) <= today;
}

export function getEndDateMin(form: CampaignFormValues, campaign: Campaign) {
  if (campaign.issuedFormsCount > 0 && campaign.endDate !== '') {
    return campaign.endDate > form.startDate
      ? campaign.endDate
      : form.startDate;
  }

  return form.startDate;
}

export function getCampaignValidationError(
  form: CampaignFormValues,
  campaign: Campaign,
) {
  if (form.endDate !== '' && form.endDate < form.startDate) {
    return 'End date cannot be earlier than the start date.';
  }

  if (isCampaignStarted(campaign) && form.startDate !== campaign.startDate) {
    return 'Start date cannot be changed after the campaign has started.';
  }

  if (
    campaign.issuedFormsCount > 0 &&
    campaign.endDate !== '' &&
    form.endDate !== '' &&
    form.endDate < campaign.endDate
  ) {
    return 'End date cannot be moved earlier after questionnaires have been issued.';
  }

  return '';
}

export function areCampaignFormsEqual(
  left: CampaignFormValues,
  right: CampaignFormValues,
) {
  return (
    left.name === right.name &&
    left.description === right.description &&
    left.startDate === right.startDate &&
    left.endDate === right.endDate &&
    left.isActive === right.isActive &&
    left.comment === right.comment
  );
}
