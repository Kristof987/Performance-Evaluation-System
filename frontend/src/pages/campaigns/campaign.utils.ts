import type {
  Campaign,
  CampaignResponse,
  CampaignFormValues,
} from './campaign.types';
export const emptyCampaignForm: CampaignFormValues = {
  name: '',
  description: '',
  startLocal: '',
  endLocal: '',
  comment: '',
};

const zone = 'Europe/Budapest';
const localParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function budapestLocal(instant: string): string {
  const parts = Object.fromEntries(localParts.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function budapestInstant(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Enter a valid Budapest date and time.');
  const [year, month, day, hour, minute] = local.split(/[-T:]/).map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(wallClock) || new Date(wallClock).toISOString().slice(0, 16) !== local) {
    throw new Error('Enter a valid Budapest date and time.');
  }
  // Check the plausible UTC offsets rather than letting Date silently normalize a DST gap or fold.
  const matches = new Set<string>();
  for (const offsetHours of [1, 2]) {
    const candidate = new Date(wallClock - offsetHours * 3600000).toISOString();
    if (budapestLocal(candidate) === local) matches.add(candidate);
  }
  if (matches.size !== 1) {
    throw new Error(matches.size ? 'This Budapest time occurs twice during the daylight-saving change. Choose a different time.' : 'This Budapest time does not exist during the daylight-saving change. Choose a different time.');
  }
  return [...matches][0];
}

export function formatDate(value: string) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

export function validateCampaignTimes(form: CampaignFormValues): string {
  try {
    const start = budapestInstant(form.startLocal);
    const end = form.endLocal ? budapestInstant(form.endLocal) : null;
    if (end && end <= start) return 'End time must be later than the start time.';
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : 'Enter a valid Budapest date and time.';
  }
}

export function mapCampaignFromResponse(campaign: CampaignResponse): Campaign {
  return {
    id: campaign.id.toString(),
    name: campaign.name,
    status: campaign.campaign_status,
    pausedFromStatus: campaign.paused_from_status ?? null,
    isArchived: campaign.is_archived,
    isActive: campaign.is_active,
    currentDate: campaign.current_date,
    start: formatDate(campaign.start_at),
    end: formatDate(campaign.end_at ?? ''),
    startDate: campaign.start_date,
    endDate: campaign.end_date ?? '',
    startAt: campaign.start_at,
    endAt: campaign.end_at,
    activationError: campaign.activation_error ?? null,
    activationRetryAt: campaign.activation_retry_at ?? null,
    activationAttempts: campaign.activation_attempts ?? 0,
    lastTransitionAt: campaign.last_transition_at ?? null,
    lifecycleError: campaign.lifecycle_error ?? null,
    lifecycleRetryAt: campaign.lifecycle_retry_at ?? null,
    description: campaign.description,
    comment: campaign.comment,
    issuedFormsCount: campaign.issued_forms_count ?? 0,
    sent: campaign.issued_forms_count ?? 0,
    done: campaign.submitted_forms_count ?? 0,
    overdue: 0,
    forms: [],
  };
}

export function getCampaignForm(campaign: Campaign): CampaignFormValues {
  return {
    name: campaign.name,
    description: campaign.description ?? '',
    startLocal: budapestLocal(campaign.startAt),
    endLocal: campaign.endAt ? budapestLocal(campaign.endAt) : '',
    comment: campaign.comment ?? '',
  };
}

export function getCampaignValidationError(
  form: CampaignFormValues,
  campaign: Campaign,
) {
  const error = validateCampaignTimes(form);
  if (error && (form.startLocal !== budapestLocal(campaign.startAt) ||
      form.endLocal !== (campaign.endAt ? budapestLocal(campaign.endAt) : ''))) return error;
  if ((campaign.status !== 'draft' && campaign.status !== 'scheduled') &&
      (form.startLocal !== budapestLocal(campaign.startAt) ||
       form.endLocal !== (campaign.endAt ? budapestLocal(campaign.endAt) : ''))) {
    return 'Dates can only be changed on draft or scheduled campaigns.';
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
    left.startLocal === right.startLocal &&
    left.endLocal === right.endLocal &&
    left.comment === right.comment
  );
}
