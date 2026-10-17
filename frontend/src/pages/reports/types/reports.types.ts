export type ReportCampaignOption = {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  lifecycle_status: 'Scheduled' | 'Ongoing' | 'Completed' | 'Disabled';
};

export type QuestionResult = {
  availability: 'available' | 'no_data' | 'suppressed';
  response_count: number | null;
  average_normalized: number | null;
  distribution_kind: 'original' | 'options' | null;
  distribution: Array<{ label: string; count: number; percentage: number }> | null;
};

export type ReportQuestion = QuestionResult & {
  key: string;
  text: string;
  type: string;
  category: 'rating' | 'choice' | 'text';
  section_id: number | null;
  section_name: string;
  required: boolean;
  required_modes: Array<'required' | 'optional'>;
  scale_min: number | null;
  scale_max: number | null;
  peer: QuestionResult | null;
  self: QuestionResult | null;
};

export type ReportQuestions = { questions: ReportQuestion[]; notes: Record<string, string> };

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
  overall_availability: 'available' | 'no_data' | 'suppressed';
};

export type ReportSectionScore = {
  id: number;
  name: string;
  average_score: number | null;
  availability: 'available' | 'no_data' | 'suppressed';
  evaluatee_count: number;
  evaluator_count: number;
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
  score_availability: 'available' | 'no_data' | 'suppressed';
  average_score_context: string;
};

export type GroupsReportGroupSummary = ReportGroupSummary & {
  score_availability?: 'available' | 'no_data' | 'suppressed';
  reportable_sections: number;
};

export type GroupsReport = {
  campaign: ReportCampaignOption;
  kpis: { groups_in_campaign: number; participating_employees: number; completed_evaluations: number; groups_with_reportable_results: number };
  groups: GroupsReportGroupSummary[];
  notes: Record<string, string>;
};

export type GroupReportDetail = {
  campaign: ReportCampaignOption;
  group: { id: number; name: string; description: string | null };
  kpis: { employees: number; completed_evaluations: number; completion_rate: number | null; reportable_sections: number; overall_peer_score: number | null };
  sections: ReportSectionScore[];
  roles: Array<{ role_id: number; role_name: string; employee_count: number; completed_evaluations_received: number; average_score: number | null; score_availability: 'available' | 'no_data' | 'suppressed' }>;
  employees: Array<{ employee_id: number; employee_name: string; role_name: string; reviews_received: number; completed_self_evaluation: boolean; feedback_availability: string }>;
  notes: Record<string, string>;
};

export type RolePerspective = 'evaluatee' | 'evaluator';

export type RoleReportSummary = {
  role_id: number;
  role_name: string;
  employee_count: number;
  completed_evaluations: number;
  available_sections: number;
  average_score: number | null;
  score_availability: 'available' | 'no_data' | 'suppressed';
  average_score_context: string;
};

export type RolesReport = {
  campaign: ReportCampaignOption;
  perspective: RolePerspective;
  kpis: { roles_in_campaign: number; participating_employees: number; completed_evaluations: number; roles_with_reportable_results: number };
  roles: RoleReportSummary[];
  section_comparison: null | { section_id: number; section_name: string; roles: Array<{ role_id: number; role_name: string; average_score: number; evaluatee_count: number; evaluator_count: number }> };
  notes: Record<string, string>;
};

export type RoleReportDetail = {
  campaign: ReportCampaignOption;
  role: { id: number; name: string };
  perspective: RolePerspective;
  kpis: { employees: number; completed_evaluations: number; reportable_sections: number; overall_score: number | null };
  sections: ReportSectionScore[];
  groups: Array<{ group_id: number; group_name: string; employee_count: number; completed_evaluations: number; average_score: number | null; score_availability: 'available' | 'no_data' | 'suppressed' }>;
  coverage: { assigned_evaluations: number; completed_evaluations: number };
  notes: Record<string, string>;
};

export type EmployeeSelfEvaluationSummary = {
  status: string;
  assigned: number;
  completed: number;
};

export type EmployeePerformanceSummary = {
  overall_peer_score: number | null;
  availability: 'available' | 'suppressed' | 'no_data';
  reportable_sections: number;
};

export type EmployeeReportRow = {
  employee_id: number;
  employee_name: string;
  email: string | null;
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

export type EmployeeReportSection = {
  id: number;
  name: string;
  peer_score: number | null;
  peer_availability: 'available' | 'suppressed' | 'no_data';
  peer_evaluator_count: number;
  self_score: number | null;
  self_availability: 'available' | 'suppressed' | 'no_data';
};

export type EmployeeSelfPeerComparison = {
  section_id: number;
  section_name: string;
  peer_average: number;
  self_average: number;
  difference: number;
  interpretation: 'Higher self-rating' | 'Lower self-rating' | 'Similar ratings';
};

export type EmployeeHistorySeries = {
  section_id: number | null;
  section_name: string;
  points: Array<{ campaign_id: number; campaign_name: string; campaign_start_date: string; average_score: number; evaluator_count: number; reportable_sections: number }>;
};

export type EmployeeReportDetail = {
  campaign: ReportCampaignOption;
  employee: { id: number; name: string; email: string | null; company_role: string; groups: string[] };
  kpis: { peer_reviews_received: number; peer_reviews_assigned: number; peer_completion_rate: number | null; self_evaluation_status: string; reportable_sections: number; overall_peer_score: number | null; overall_self_score: number | null };
  sections: EmployeeReportSection[];
  section_availability: 'no_assignments' | 'not_submitted' | 'no_sections' | 'no_ratings' | 'suppressed' | 'available';
  self_peer_comparison: EmployeeSelfPeerComparison[];
  coverage: { peer_assigned: number; peer_completed: number; peer_outstanding: number; distinct_peer_evaluators: number | null; self_evaluation: EmployeeSelfEvaluationSummary; campaign_end_date: string | null };
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
  | 'section_policy'
  | 'self_evaluation_policy'
  | 'participant_deduplication'
  | 'group_attribution'
  | 'confidentiality',
  string
>;

export type CampaignReportOverview = {
  campaign: ReportCampaignOption;
  kpis: ReportKpiSummary;
  sections: ReportSectionScore[];
  groups: ReportGroupSummary[];
  employees: ReportEmployeeOverview;
  notes: ReportDataNotes;
};
