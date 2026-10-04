export type CampaignStatus = 'Active' | 'Closed';

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  start: string;
  end: string;
  startDate: string;
  endDate: string;
  description: string | null;
  comment: string | null;
  issuedFormsCount: number;
  sent: number;
  done: number;
  overdue: number;
  resultsReady?: boolean;
  forms: Array<[string, string, number, number, string]>;
};

export type CampaignResponse = {
  id: number;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  comment: string | null;
  issued_forms_count: number;
};

export type CampaignFormValues = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  comment: string;
};

export type CampaignStatusFilter = 'All statuses' | CampaignStatus;
export type UpdateCampaignField = <K extends keyof CampaignFormValues>(
  field: K,
  value: CampaignFormValues[K],
) => void;
