import type { CampaignLifecycleStatus } from './campaign.lifecycle';
export type CampaignStatus = CampaignLifecycleStatus;

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  isActive: boolean;
  currentDate: string;
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
  submitted_forms_count: number;
  current_date: string;
  lifecycle_status: CampaignLifecycleStatus;
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
  locked?: boolean;
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
      locked?: boolean;
    }>;
  }>;
};

export type CampaignEvaluationMatrixEmployee = {
  id: number;
  name: string;
  roleId: number;
  roleName: string;
  active?: boolean;
};

export type CampaignEvaluationMatrixAssignment = {
  evaluatorId: number;
  evaluateeId: number;
  formId: number;
  filledFormId: number | null;
  issued: boolean;
  isCompleted: boolean;
  statusName: string;
  hasAnswers: boolean;
};

export type CampaignGroupEvaluationMatrix = {
  groupId: number;
  groupName: string;
  employees: CampaignEvaluationMatrixEmployee[];
  assignments: CampaignEvaluationMatrixAssignment[];
};

export type CampaignEvaluationMatrix = {
  groups: CampaignGroupEvaluationMatrix[];
  issuanceErrors?: string[];
};

export type CampaignEvaluationMatrixResponse = {
  issuance_errors: string[];
  groups: Array<{
    group_id: number;
    group_name: string;
    employees: Array<{
      id: number;
      name: string;
      role_id: number;
      role_name: string;
      active?: boolean;
    }>;
    assignments: Array<{
      evaluator_id: number;
      evaluatee_id: number;
      form_id: number;
      filled_form_id: number | null;
      issued: boolean;
      is_completed: boolean;
      status_name: string;
      has_answers: boolean;
    }>;
  }>;
};

export type CampaignEvaluationMatrixUpdateResponse = CampaignEvaluationMatrixResponse & {
  created_count: number;
  removed_count: number;
  kept_completed_count: number;
};

export type CampaignSelfEvaluations = {
  forms: CampaignRuleForm[];
  participants: Array<{
    employeeId: number;
    name: string;
    roleName: string;
    groupNames: string[];
    formId: number | null;
    locked: boolean;
  }>;
};

export type CampaignSelfEvaluationsResponse = {
  forms: CampaignRuleForm[];
  participants: Array<{
    employee_id: number;
    employee_name: string;
    role_name: string;
    group_names: string[];
    form_id: number | null;
    locked: boolean;
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
