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

export type CampaignGroup = {
  id: number;
  name: string;
  description: string | null;
};

export type CampaignGroups = {
  availableGroups: CampaignGroup[];
  assignedGroupIds: number[];
};

export type CampaignGroupsResponse = {
  available_groups: CampaignGroup[];
  assigned_group_ids: number[];
};

export type CampaignRuleForm = {
  id: number;
  name: string;
};

export type CampaignRolePairRule = {
  evaluatorRoleId: number;
  evaluatorRoleName: string;
  evaluateeRoleId: number;
  evaluateeRoleName: string;
  formId: number | null;
  ruleId: number | null;
};

export type CampaignGroupRuleMatrix = {
  groupId: number;
  groupName: string;
  rolePairs: CampaignRolePairRule[];
};

export type CampaignEvaluationRules = {
  forms: CampaignRuleForm[];
  groups: CampaignGroupRuleMatrix[];
};

export type CampaignEvaluationRulesResponse = {
  forms: CampaignRuleForm[];
  groups: Array<{
    group_id: number;
    group_name: string;
    role_pairs: Array<{
      evaluator_role_id: number;
      evaluator_role_name: string;
      evaluatee_role_id: number;
      evaluatee_role_name: string;
      form_id: number | null;
      rule_id: number | null;
    }>;
  }>;
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
