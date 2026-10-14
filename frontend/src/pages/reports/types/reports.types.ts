export type ReportCampaignOption = {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
};

export type ReportKpiSummary = {
  total_evaluations: number;
  completed_evaluations: number;
  completion_rate: number;
  submitted_evaluations: number;
  employees_evaluated: number;
  overall_score: number | null;
  overall_score_label: string;
  overall_score_context: string;
  overall_score_scale: string | null;
};

export type ReportDimensionScore = {
  id: string;
  name: string;
  average_score: number;
  response_count: number;
  evaluatee_count: number;
  scale_min: number;
  scale_max: number;
  evaluator_count?: number;
  campaign_average_score?: number | null;
};

export type ReportRatingDistributionSource = {
  id: string;
  label: string;
  source_type: string;
  scale_min: number;
  scale_max: number;
  response_count: number;
  buckets: Array<{ rating: number; count: number }>;
};

export type ReportGroupSummary = {
  group_id: number;
  group_name: string;
  employee_count: number;
  total_evaluations: number;
  completed_evaluations: number;
  completion_rate: number | null;
  description?: string | null;
  average_score: number | null;
  average_score_context: string;
};

export type GroupsReport = {
  campaign: ReportCampaignOption;
  kpis: { groups_in_campaign: number; participating_employees: number; completed_evaluations: number; groups_with_reportable_results: number };
  groups: ReportGroupSummary[];
  notes: Record<string, string>;
};

export type GroupReportDetail = {
  campaign: ReportCampaignOption;
  group: { id: number; name: string; description: string | null };
  kpis: { employees: number; completed_evaluations: number; completion_rate: number | null; reportable_dimensions: number };
  dimensions: ReportDimensionScore[];
  rating_distribution_sources: ReportRatingDistributionSource[];
  roles: Array<{ role_id: number; role_name: string; employee_count: number; completed_evaluations_received: number; average_score: number | null }>;
  employees: Array<{ employee_id: number; employee_name: string; role_name: string; reviews_received: number; completed_self_evaluation: boolean; feedback_availability: string }>;
  notes: Record<string, string>;
};

export type RolePerspective = 'evaluatee' | 'evaluator';

export type RoleReportSummary = {
  role_id: number;
  role_name: string;
  employee_count: number;
  completed_evaluations: number;
  available_dimensions: number;
  average_score: number | null;
  average_score_context: string;
};

export type RolesReport = {
  campaign: ReportCampaignOption;
  perspective: RolePerspective;
  kpis: { roles_in_campaign: number; participating_employees: number; completed_evaluations: number; roles_with_reportable_results: number };
  roles: RoleReportSummary[];
  dimension_comparison: null | { dimension_id: string; dimension_name: string; roles: Array<{ role_id: number; role_name: string; average_score: number; response_count: number; scale_min: number; scale_max: number }> };
  notes: Record<string, string>;
};

export type RoleReportDetail = {
  campaign: ReportCampaignOption;
  role: { id: number; name: string };
  perspective: RolePerspective;
  kpis: { employees: number; completed_evaluations: number; reportable_dimensions: number; overall_score: number | null };
  dimensions: ReportDimensionScore[];
  rating_distribution_sources: ReportRatingDistributionSource[];
  groups: Array<{ group_id: number; group_name: string; employee_count: number; completed_evaluations: number; average_score: number | null }>;
  coverage: { assigned_evaluations: number; completed_evaluations: number };
  notes: Record<string, string>;
};

export type EmployeeSelfEvaluationSummary = {
  status: string;
  assigned: number;
  completed: number;
};

export type EmployeePerformanceSummary = {
  average_score: number | null;
  scale_min: number | null;
  scale_max: number | null;
  suppressed: boolean;
};

export type EmployeeReportRow = {
  employee_id: number;
  employee_name: string;
  email: string;
  company_role: string;
  groups: string[];
  peer_assigned: number;
  peer_completed: number;
  self_evaluation: EmployeeSelfEvaluationSummary;
  performance_summary: EmployeePerformanceSummary;
};

export type EmployeeReportsOverview = {
  campaign: ReportCampaignOption;
  kpis: {
    participating_employees: number;
    employees_with_peer_feedback: number;
    awaiting_peer_feedback: number;
    completed_self_evaluations: number;
    assigned_self_evaluations: number;
  };
  employees: EmployeeReportRow[];
  notes: Record<string, string>;
};

export type EmployeeReportDimension = {
  id: string;
  name: string;
  average_score: number | null;
  suppressed: boolean;
  response_count: number;
  evaluator_count: number;
  scale_min: number;
  scale_max: number;
  direction: string;
};

export type EmployeeSelfPeerComparison = {
  dimension_id: string;
  dimension_name: string;
  peer_average: number;
  self_average: number;
  difference: number;
  scale_min: number;
  scale_max: number;
};

export type EmployeeHistorySeries = {
  dimension_id: string;
  dimension_name: string;
  scale_min: number;
  scale_max: number;
  points: Array<{ campaign_id: number; campaign_name: string; campaign_start_date: string; average_score: number; response_count: number; evaluator_count: number }>;
};

export type EmployeeReportDetail = {
  campaign: ReportCampaignOption;
  employee: { id: number; name: string; email: string; company_role: string; groups: string[] };
  kpis: { peer_reviews_received: number; peer_reviews_assigned: number; peer_completion_rate: number | null; self_evaluation_status: string; reportable_dimensions: number };
  dimensions: EmployeeReportDimension[];
  dimension_availability: 'no_assignments' | 'not_submitted' | 'no_dimensions' | 'no_compatible_responses' | 'suppressed' | 'available';
  self_peer_comparison: EmployeeSelfPeerComparison[];
  coverage: { peer_assigned: number; peer_completed: number; peer_outstanding: number; self_evaluation: EmployeeSelfEvaluationSummary; campaign_end_date: string | null };
  history: EmployeeHistorySeries[];
  notes: Record<string, string>;
};

export type ReportEmployeeOverview = {
  participating_employees: number;
  employees_with_completed_peer_feedback: number;
  employees_awaiting_peer_feedback: number;
  configured_self_evaluations: number;
  completed_self_evaluations: number;
};

export type ReportDataNotes = Record<
  | 'completed_definition'
  | 'answer_storage'
  | 'question_identity'
  | 'historical_versions'
  | 'dimension_policy'
  | 'self_evaluation_policy'
  | 'participant_deduplication'
  | 'group_attribution'
  | 'confidentiality',
  string
>;

export type CampaignReportOverview = {
  campaign: ReportCampaignOption;
  kpis: ReportKpiSummary;
  dimensions: ReportDimensionScore[];
  rating_distribution_sources: ReportRatingDistributionSource[];
  groups: ReportGroupSummary[];
  employees: ReportEmployeeOverview;
  notes: ReportDataNotes;
};
