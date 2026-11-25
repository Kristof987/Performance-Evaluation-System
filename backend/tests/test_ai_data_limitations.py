"""The backend states it when nobody else's evaluation could be released to the model."""

import re
from types import SimpleNamespace

from services import ai_generation_service as generation
from services.ai_analysis_models import AnalysisFinding, EmployeeAIAnalysis


def analysis(reasoning="The employee rates their own work above the midpoint."):
    finding = AnalysisFinding(assessment="Positive self-view", reasoning=reasoning, supporting_evidence_ids=["e1"])
    return EmployeeAIAnalysis(overall_assessment=finding, strengths=[], development_areas=[])


def context(*, withheld, released_from_others):
    warnings = [SimpleNamespace(code="insufficient_peer_reviewers")] if withheld else []
    references = [SimpleNamespace(category="self")] + ([SimpleNamespace(category="peer")] if released_from_others else [])
    return SimpleNamespace(warnings=warnings, evidence_references=references)


def test_the_note_is_added_when_no_evaluation_from_others_was_released():
    result = generation._with_data_limitations(analysis(), context(withheld=True, released_from_others=False))
    assert result.overall_assessment.reasoning == (
        "The employee rates their own work above the midpoint. " + generation.OTHERS_WITHHELD_NOTE)


def test_no_note_when_others_were_released_or_nothing_was_withheld():
    for case in (context(withheld=True, released_from_others=True), context(withheld=False, released_from_others=False)):
        original = analysis()
        assert generation._with_data_limitations(original, case) == original


def test_a_long_reasoning_keeps_whole_sentences_within_the_limit():
    sentence = "This sentence describes the self-view in some detail."
    long = " ".join([sentence] * (generation.MAX_REASONING_LENGTH // (len(sentence) + 1)))
    assert len(long) > generation.MAX_REASONING_LENGTH - len(generation.OTHERS_WITHHELD_NOTE)
    result = generation._with_data_limitations(analysis(long), context(withheld=True, released_from_others=False))
    reasoning = result.overall_assessment.reasoning
    assert len(reasoning) <= generation.MAX_REASONING_LENGTH and reasoning.endswith(generation.OTHERS_WITHHELD_NOTE)
    assert reasoning.removesuffix(generation.OTHERS_WITHHELD_NOTE).strip().endswith("detail.")
    AnalysisFinding.model_validate(result.overall_assessment.model_dump())


def test_the_note_passes_the_prose_checks_an_approval_runs_again():
    note = generation.OTHERS_WITHHELD_NOTE
    number = re.compile(r"\d|%|\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|percent|per cent)\b", re.I)
    for rule in (number, generation._PEER, generation._SELF, generation._TREND, generation._TEMPORAL_TREND,
                 generation._RANKING, generation._COMPARISON, generation._RELATIVE, generation._EXPLICIT_COMPARISON,
                 generation._ACTION, generation._EMPLOYMENT_DECISION, generation._REVIEWER_CONSISTENCY,
                 generation._RATING_CONSISTENCY, generation._SELF_REPORTED_CONSISTENCY):
        assert not rule.search(note), rule.pattern


def test_the_prompt_names_the_number_words_the_validator_rejects():
    for word in ("two", "three", "ten", "percent"):
        assert re.search(rf"\b{word}\b", generation._INSTRUCTIONS)
