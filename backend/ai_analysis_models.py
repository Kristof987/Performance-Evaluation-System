"""Internal, authorized performance-analysis data contract (not an API response)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class AnalysisModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CampaignAnalysisMetadata(AnalysisModel):
    campaign_id: int
    campaign_name: str
    lifecycle_status: Literal["review", "closed"]
    analyzed_at: datetime
    normalization: str = "Issued integer ratings mapped to 1-5; ordinal averages are descriptive, not interval measurements."


class EvaluationSource(AnalysisModel):
    filled_form_id: int
    questionnaire_name: str
    snapshot_schema_version: int
    category: Literal["self", "peer"]


class EvidenceReference(AnalysisModel):
    evidence_id: str
    filled_form_id: int
    question_id: str
    question_text: str
    section_id: int | None = None
    section_name: str | None = None
    category: Literal["self", "peer"]
    original_value: int | None = None
    normalized_value: float | None = None


class QualitativeEvidence(AnalysisModel):
    reference: EvidenceReference
    response_text: str


class RatingDistributionBin(AnalysisModel):
    original_value: int
    count: int


class QuantitativeStatistics(AnalysisModel):
    availability: Literal["available", "no_data", "suppressed"]
    answer_count: int | None = None
    average_normalized: float | None = None
    minimum_normalized: float | None = None
    maximum_normalized: float | None = None
    normalized_range: float | None = None
    original_distribution: list[RatingDistributionBin] = []
    evidence_ids: list[str] = []


class QuestionEvidence(AnalysisModel):
    question_key: str
    question_text: str
    question_type: str
    section_id: int | None = None
    section_name: str | None = None
    scale_min: int | None = None
    scale_max: int | None = None
    min_label: str | None = None
    max_label: str | None = None
    peer: QuantitativeStatistics
    self_evaluation: QuantitativeStatistics


class SectionStatistics(AnalysisModel):
    section_id: int
    section_name: str
    peer: QuantitativeStatistics
    self_evaluation: QuantitativeStatistics


class OverallStatistics(AnalysisModel):
    peer: QuantitativeStatistics
    self_evaluation: QuantitativeStatistics
    weighting: str = "Mean of reportable Section means; standalone ratings are reported at question level only."


class EvaluatorCategoryComparison(AnalysisModel):
    section_id: int
    peer_average: float
    self_average: float
    self_minus_peer: float
    evidence_ids: list[str]


class DataQualityWarning(AnalysisModel):
    code: str
    message: str


class EmployeeAnalysisContext(AnalysisModel):
    campaign_id: int
    evaluatee_employee_id: int
    submitted_evaluation_count: int
    metadata: CampaignAnalysisMetadata
    sources: list[EvaluationSource]
    questions: list[QuestionEvidence]
    sections: list[SectionStatistics]
    overall: OverallStatistics
    comparisons: list[EvaluatorCategoryComparison]
    qualitative_evidence: list[QualitativeEvidence]
    evidence_references: list[EvidenceReference]
    warnings: list[DataQualityWarning]


class NumericClaim(AnalysisModel):
    marker: str = Field(min_length=6, max_length=7)
    statistic_id: str = Field(min_length=1, max_length=160)
    value: str = Field(min_length=1, max_length=32)


class AnalysisFinding(AnalysisModel):
    assessment: str = Field(min_length=1, max_length=1200)
    reasoning: str = Field(min_length=1, max_length=2000)
    supporting_evidence_ids: list[str] = Field(min_length=1, max_length=30)
    numeric_claims: list[NumericClaim] = Field(default_factory=list, max_length=20)

    @field_validator("assessment", "reasoning")
    @classmethod
    def nonempty_prose(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Analysis prose cannot be blank")
        return value.strip()

    @model_validator(mode="after")
    def unique_references(self):
        if any(not item.strip() for item in self.supporting_evidence_ids) or len(set(self.supporting_evidence_ids)) != len(self.supporting_evidence_ids):
            raise ValueError("Evidence references must be nonempty and unique")
        return self


class EmployeeAIAnalysis(AnalysisModel):
    overall_assessment: AnalysisFinding
    strengths: list[AnalysisFinding] = Field(max_length=5)
    development_areas: list[AnalysisFinding] = Field(max_length=5)
