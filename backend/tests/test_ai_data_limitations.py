"""The backend states it when nobody else's evaluation could be released to the model."""

import re
from types import SimpleNamespace

import pytest

from services import ai_generation_service as generation
from services.ai_analysis_models import AnalysisFinding, EmployeeAIAnalysis


def analysis(reasoning="The employee rates their own work above the midpoint."):
    finding = AnalysisFinding(assessment="Positive self-view", reasoning=reasoning, supporting_evidence_ids=["e1"],
                            fact_ids=["F1"])
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


def test_the_note_passes_the_prose_checks_of_generated_text():
    note = generation.OTHERS_WITHHELD_NOTE
    number = re.compile(r"\d|%|\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|percent|per cent)\b", re.I)
    for rule in (number, generation._PEER, generation._SELF, generation._TREND_OR_CONSISTENCY,
                 generation._RANKING, generation._RELATIVE, generation._EXPLICIT_COMPARISON,
                 generation._ACTION, generation._EMPLOYMENT_DECISION):
        assert not rule.search(note), rule.pattern


@pytest.mark.parametrize("text", [
    "She promotes collaboration in the team.",
    "He can be dismissive of others' ideas.",
    "Strong teamwork compensates for weaker planning.",
    "The results are consistent with the written comments.",
])
def test_ordinary_prose_is_not_mistaken_for_a_forbidden_claim(text):
    assert not generation._EMPLOYMENT_DECISION.search(text)
    assert not generation._TREND_OR_CONSISTENCY.search(text)


@pytest.mark.parametrize("text", [
    "She deserves a promotion.", "He should be promoted to team lead.", "Consider termination of his contract.",
    "He could be let go.", "A salary increase is justified.", "She has earned a bonus.",
])
def test_employment_decisions_are_rejected(text):
    assert generation._EMPLOYMENT_DECISION.search(text)


@pytest.mark.parametrize("text", ["She communicates consistently.", "A steady trend of improvement.",
                                  "He repeatedly missed deadlines.", "Her focus improved over time."])
def test_trend_and_consistency_words_are_rejected(text):
    assert generation._TREND_OR_CONSISTENCY.search(text)


def test_the_prompt_names_the_number_words_the_validator_rejects():
    for word in ("two", "three", "ten", "percent"):
        assert re.search(rf"\b{word}\b", generation._INSTRUCTIONS)


def hr_edit(text, comments=None):
    """Run the checks an HR edit or an approval runs on one saved finding."""
    fact = generation._AuthorizedFact("fact:v2:x", "observation:peer_comment", "written_feedback", "Teamwork",
                                      "One colleague's written comment.", "", frozenset({"e1"}), (), ())
    finding = AnalysisFinding(assessment="Teamwork", reasoning=text, supporting_evidence_ids=["e1"], fact_ids=[fact.identifier])
    edited = EmployeeAIAnalysis(overall_assessment=finding, strengths=[], development_areas=[])
    return generation._verify_with_comparisons(edited, {"e1": "peer"}, {}, {fact.identifier: fact},
                                               comments=comments or {}, check_prose=False)


def test_hr_edits_are_not_held_to_the_model_wording_rules():
    hr_edit("Strong in 3 of the 4 sections; colleagues consistently mention Q4.")


def test_hr_edits_still_cannot_quote_a_colleague():
    comment = "always ready to help the newcomers settle into the team"
    with pytest.raises(generation.AnalysisGenerationError):
        hr_edit(f"A colleague wrote she is {comment}.", comments={"e1": (comment, "author")})
