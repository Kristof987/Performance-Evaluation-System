export type NumericClaim = { marker: string; statistic_id: string; value: string };

export type AnalysisFinding = {
  assessment: string;
  reasoning: string;
  supporting_evidence_ids: string[];
  numeric_claims: NumericClaim[];
};

export type EmployeeAIAnalysis = {
  overall_assessment: AnalysisFinding;
  strengths: AnalysisFinding[];
  development_areas: AnalysisFinding[];
};

export type AnalysisEvidence = {
  question_text: string;
  section_name: string | null;
  category: 'peer' | 'self';
  original_value?: number | null;
  normalized_value?: number | null;
  response_text?: string;
  question_statistics: Array<{
    question_text: string;
    average_normalized: number | null;
    answer_count: number | null;
    scale_min: number | null;
    scale_max: number | null;
    min_label: string | null;
    max_label: string | null;
    original_distribution: Array<{ original_value: number; count: number }>;
  }>;
  section_statistics: Array<{ section_name: string; average_normalized: number | null; contributor_count: number | null }>;
};

export type AnalysisVersion = {
  id: number;
  version: number;
  parent_analysis_id: number | null;
  status: 'draft' | 'approved';
  is_current_approved: boolean;
  outdated: boolean;
  analysis: EmployeeAIAnalysis;
  evidence: Record<string, AnalysisEvidence>;
  model_identifier: string;
  generated_at: string;
  generated_by_user_id: number;
  edited_at: string | null;
  edited_by_user_id: number | null;
  approved_at: string | null;
  approved_by_user_id: number | null;
};

export type EmployeeAIAnalysisHistory = {
  versions: AnalysisVersion[];
  can_manage: boolean;
  has_eligible_evidence: boolean;
};
