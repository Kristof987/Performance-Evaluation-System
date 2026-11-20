export type ReportCampaignOption = {
  id: number;
  name: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  campaign_status: 'draft' | 'scheduled' | 'active' | 'paused' | 'review' | 'closed';
  is_archived: boolean;
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
};

export type ReportQuestions = { evaluation_type: 'peer' | 'self'; questions: ReportQuestion[]; notes: Record<string, string> };

export type WrittenFeedbackResponse = {
  question_key: string;
  question_type: 'Text';
  section_id: number | null;
  evaluation_type: 'peer' | 'self';
  scope: 'campaign' | 'employee';
  availability: 'available' | 'no_data' | 'suppressed' | 'not_applicable';
  response_count: number | null;
  responses: string[];
};

export type WrittenFeedbackIndex = {
  evaluation_type: 'peer' | 'self';
  scope: 'campaign' | 'employee';
  questions: Array<{ key: string; text: string; section_id: number | null; section_name: string; response_count: number }>;
  evaluatees: Array<{ evaluatee_id: number; evaluatee_name: string }>;
};

export type RatingDistribution = {
  section_id: number | null;
  availability: 'available' | 'no_data' | 'suppressed';
  response_count: number | null;
  bins: Array<{ label: string; count: number; percentage: number }> | null;
};

export type CampaignRatingDistribution = { campaign: RatingDistribution; sections: RatingDistribution[]; notes: string };

export type EvaluationQualityCategory =
  | 'uniform_rating_pattern'
  | 'higher_rating_tendency'
  | 'lower_rating_tendency'
  | 'peer_rating_disagreement'
  | 'rating_distribution_concentration';

export type EvaluationQualityFinding = {
  category: EvaluationQualityCategory;
  title: string;
  description: string;
  scope: string;
  section_name: string | null;
  eligible_observations: number | null;
  statistics: Record<string, number>;
  method: string;
  rule: string;
  informational: boolean;
};

export type EvaluationQualityReport = {
  campaign: ReportCampaignOption;
  analysis_status: 'preliminary' | 'final' | 'unavailable';
  data_status: 'no_data' | 'insufficient_data' | 'analyzed';
  completed_peer_reviews: number;
  assigned_peer_reviews: number;
  peer_reviews_analyzed: number;
  rating_observations: number | null;
  findings_count: number;
  findings_by_category: Partial<Record<EvaluationQualityCategory, EvaluationQualityFinding[]>>;
  statistics: {
    mean_normalized: number | null;
    standard_deviation: number | null;
    maximum_percentage: number | null;
    modal_percentage: number | null;
    distribution: Array<{ label: string; count: number; percentage: number }>;
  };
  coverage: {
    status: 'no_completed' | 'insufficient' | 'analyzed';
    message: string;
    matched_observations: number | null;
    comparable_employees: number | null;
    detectors: Record<EvaluationQualityCategory, 'analyzed' | 'insufficient'>;
  };
};

export type ReportSectionComparison = { section_id: number; groups: Array<{ id: number; name: string; average_score: number }>; roles: Array<{ id: number; name: string; average_score: number }> };

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
  question_count?: number;
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


export type GroupReportDetail = {
  campaign: ReportCampaignOption;
  group: { id: number; name: string; description: string | null };
  kpis: { employees: number; completed_evaluations: number; completion_rate: number | null; reportable_sections: number; overall_peer_score: number | null };
  sections: ReportSectionScore[];
  roles: Array<{ role_id: number; role_name: string; employee_count: number; completed_evaluations_received: number; average_score: number | null; score_availability: 'available' | 'no_data' | 'suppressed' }>;
  employees: Array<{ employee_id: number; employee_name: string; role_name: string; reviews_received: number; reviews_assigned?: number; completed_self_evaluation: boolean; feedback_availability: string; peer_score?: number | null; score_availability?: ScoreAvailability }>;
  notes: Record<string, string>;
};

export type RolePerspective = 'evaluatee' | 'evaluator';

export type EmployeeSelfEvaluationSummary = {
  status: string;
  assigned: number;
  completed: number;
};

export type EmployeePerformanceSummary = {
  overall_peer_score: number | null;
  availability: 'available' | 'suppressed' | 'no_data';
  reportable_sections: number;
  overall_self_score: number | null;
  previous_overall_peer_score: number | null;
  section_scores: Record<string, number | null>;
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
  group_ids: number[];
};

export type EmployeeReportsOverview = {
  campaign: ReportCampaignOption;
  kpis: {
    participating_employees: number;
    peer_reviews_assigned: number;
    peer_reviews_completed: number;
    employees_with_peer_feedback: number;
    awaiting_peer_feedback: number;
    completed_self_evaluations: number;
    assigned_self_evaluations: number;
  };
  employees: EmployeeReportRow[];
  previous_campaign: ReportCampaignOption | null;
  sections: Array<{ id: number; name: string }>;
  groups: Array<{ id: number; name: string }>;
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
  previous_campaign: ReportCampaignOption | null;
  previous: { overall_peer_score: number | null; sections: Record<string, number | null> } | null;
  benchmarks: {
    campaign: EmployeeBenchmark | null;
    groups: Array<EmployeeBenchmark & { id: number; name: string }>;
  };
  notes: Record<string, string>;
};
export type EmployeeBenchmark = { overall: number | null; sections: Record<string, number | null> };

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

export type ScoreAvailability = 'available' | 'no_data' | 'suppressed';
export type DashboardScore = { score: number | null; availability: ScoreAvailability };
export type DashboardDeltaScore = DashboardScore & { previous_score: number | null };
export type DashboardGroup = {
  id: number;
  name: string;
  employee_count: number;
  completed_evaluations: number;
  total_evaluations: number;
  completion_rate: number | null;
  overall: DashboardDeltaScore;
  sections: Record<string, DashboardScore>;
};
export type DashboardTrendPoint = {
  campaign: ReportCampaignOption;
  overall: number | null;
  completion_rate: number | null;
  sections: Record<string, number | null>;
  groups: Record<string, number | null>;
  group_sections: Record<string, Record<string, number | null>>;
  roles: Record<string, number | null>;
  role_sections: Record<string, Record<string, number | null>>;
};
/** How evaluators in one company role rate their colleagues, for calibration. */
export type DashboardRater = { id: number; name: string; evaluator_count: number; overall: { score: number | null; availability: ScoreAvailability } };
export type CampaignDashboard = {
  campaign: ReportCampaignOption;
  previous_campaign: ReportCampaignOption | null;
  completion: { completed_evaluations: number; total_evaluations: number; rate: number | null; previous_rate: number | null };
  overall: DashboardDeltaScore;
  sections: Array<DashboardDeltaScore & { id: number; name: string }>;
  groups: DashboardGroup[];
  /** Group leaders only: the whole campaign as a reference next to the groups they lead. */
  benchmark?: { overall: { score: number | null; availability: ScoreAvailability }; sections: Record<string, { score: number | null; availability: ScoreAvailability }> } | null;
  /** Evaluated employees' company roles, in the same shape as groups. */
  roles: DashboardGroup[];
  raters: DashboardRater[];
  trend: DashboardTrendPoint[];
};
export type SectionQuestionCell = { availability: ScoreAvailability; response_count: number | null; average: number | null; distribution?: Array<{ label: string; count: number; percentage: number }> | null };
export type SectionQuestion = SectionQuestionCell & {
  key: string;
  text: string;
  type: string;
  category: 'rating' | 'choice' | 'text';
  scale_min: number | null;
  scale_max: number | null;
  previous_average: number | null;
  distribution_kind: 'original' | 'options' | null;
  self: SectionQuestionCell;
  groups: Record<string, SectionQuestionCell>;
};
export type SectionQuestions = {
  campaign: ReportCampaignOption;
  previous_campaign: ReportCampaignOption | null;
  section: { id: number; name: string };
  /** Whether the compared cohorts in `groups` are groups or roles. */
  dimension?: 'groups' | 'roles';
  groups: Array<{ id: number; name: string }>;
  questions: SectionQuestion[];
};

export type AnswersIndexEmployee = { employee_id: number; employee_name: string; self_assigned: boolean; self_submitted: boolean; peer_assigned: number; peer_submitted: number };
export type AnswersIndex = { campaign_id: number; min_peer_reviewers: number; employees: AnswersIndexEmployee[] };
export type SubmittedAnswer = { question_id: string; text: string; type: string; required: boolean; answered: boolean; rating: number | null; rating_label?: string | null; scale_min: number | null; scale_max: number | null; choices: string[]; text_answer: string | null };
export type SubmittedQuestionnaire = { label: string; kind: 'self' | 'peer'; form_name: string; sections: Array<{ section_id: number | null; section_name: string; answers: SubmittedAnswer[] }> };
export type EmployeeAnswers = { campaign_id: number; employee: { id: number; name: string }; min_peer_reviewers: number; self_assigned: boolean; self_submitted: boolean; peer_assigned: number; peer_submitted: number; peer_availability: 'available' | 'no_data' | 'suppressed'; questionnaires: SubmittedQuestionnaire[] };
