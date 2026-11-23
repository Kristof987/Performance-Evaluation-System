from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from services import ai_generation_service
import models
from services import reporting_service
from services.ai_analysis_models import (EmployeeAIAnalysis, GeneratedAnalysis, GeneratedFinding, GeneratedTheme,
                                TranslatedAnalysis, TranslatedFinding)
from services.ai_analysis_service import build_employee_analysis_context, redact_names
from database import SessionLocal


@pytest.fixture
def db():
    session = SessionLocal()
    session.commit = session.flush
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def permissions(monkeypatch):
    monkeypatch.setattr(reporting_service, "_has_permission", lambda _actor, _db, permission: permission in {"reports.read", "campaigns.manage"})


def add(db, item):
    db.add(item)
    db.flush()
    return item


class World:
    def __init__(self, db, names):
        self.db = db
        suffix = uuid4().hex[:8]
        role = add(db, models.CompanyRole(name=f"Role {suffix}"))
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"System {suffix}"))
        self.actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                         system_role_id=system_role.id, is_active=True))
        self.done = db.query(models.FormStatus).filter_by(name="Completed").first() or add(db, models.FormStatus(name="Completed"))
        self.section = add(db, models.Section(scope_key="default", name=f"Teamwork {suffix}", normalized_name=f"teamwork {suffix}"))
        self.form = add(db, models.Form(name=f"Form {suffix}", questions=[]))
        self.group = add(db, models.CompanyGroup(name=f"Group {suffix}"))
        self.people = []
        for index, name in enumerate(names):
            user = add(db, models.User(username=f"u{index}-{suffix}", email=f"u{index}-{suffix}@example.com", password_hash="",
                                       system_role_id=system_role.id, is_active=True))
            self.people.append(add(db, models.Employee(user_id=user.id, full_name=f"{name} {suffix}", company_role_id=role.id, is_active=True)))
        self.campaign = add(db, models.Campaign(name=f"Campaign {suffix}", status="closed", is_active=False,
                                                start_date=datetime(2090, 1, 1, tzinfo=timezone.utc), created_by=self.actor.id))
        db.execute(models.campaign_company_groups.insert().values(campaign_id=self.campaign.id, company_group_id=self.group.id))

    def snapshot(self):
        return {"schema_version": 2, "questions": [
            {"type": "section", "section_id": self.section.id, "section": {"id": self.section.id, "name": self.section.name},
             "questions": [{"id": "rating", "type": "Scale 1-5", "text": "Works well with others"}]},
            {"type": "question", "question": {"id": "comment", "type": "Text", "text": "What should they keep doing?"}}]}

    def review(self, evaluator, rating, comment):
        add(self.db, models.FilledForm(campaign_id=self.campaign.id, form_id=self.form.id, company_group_id=self.group.id,
                                       evaluator_id=evaluator.id, evaluatee_id=self.people[0].id, status_id=self.done.id,
                                       finish_date=date(2090, 2, 1), form_snapshot=self.snapshot(),
                                       answers=[{"question_id": "rating", "value": rating}, {"question_id": "comment", "value": comment}]))


def test_names_are_replaced_with_hungarian_suffixes_and_shared_surnames():
    text = "Anna mindig segít, Kovács Béla szerint is. Annával jó dolgozni. Bélának igaza van."
    assert redact_names(text, "Kovács Anna", ["Kovács Anna", "Kovács Béla"]) == (
        "[the employee] mindig segít, [colleague] szerint is. [the employee] jó dolgozni. [colleague] igaza van.")


def test_quotes_are_detected_from_six_consecutive_words():
    comment = "She rarely speaks up in team meetings, although her ideas are good."
    assert ai_generation_service.quotes_comment("Colleagues note she rarely speaks up in team meetings.", [comment])
    assert not ai_generation_service.quotes_comment("Several colleagues see her as quiet in meetings.", [comment])


def test_peer_comments_need_two_colleagues_and_lose_names_and_authors(db):
    world = World(db, ["Anna", "Béla", "Cecil", "Dóra"])
    anna, bela, cecil, _dora = world.people
    world.review(bela, 4, f"Always meets deadlines. Ask {cecil.full_name} too.")
    single = build_employee_analysis_context(db, world.campaign.id, anna.id, actor=world.actor)
    assert single.qualitative_evidence == []
    assert "peer_text_withheld" in {warning.code for warning in single.warnings}

    world.review(cecil, 3, f"{anna.full_name} is quiet in meetings.")
    context = build_employee_analysis_context(db, world.campaign.id, anna.id, actor=world.actor)
    comments = sorted(item.response_text for item in context.qualitative_evidence)
    assert comments == ["Always meets deadlines. Ask [colleague] too.", "[the employee] is quiet in meetings."]
    authors = {item.author_key for item in context.qualitative_evidence}
    assert len(authors) == 2 and not any(str(person.id) in key for key in authors for person in (bela, cecil))


def generate(db, world, analyses, monkeypatch):
    context = build_employee_analysis_context(db, world.campaign.id, world.people[0].id, actor=world.actor)
    calls = []

    def fake(payload, *, correction_category=None, instructions=None, trace=None):
        calls.append(correction_category)
        if trace is not None:
            trace.model = "fake"
            trace.prompt_text = instructions or ""
        facts = {fact["description"]: fact["id"] for fact in payload["facts"]}
        return analyses[min(len(calls), len(analyses)) - 1](facts), "fake"

    monkeypatch.setattr(ai_generation_service, "_request_analysis", fake)
    return ai_generation_service.generate_employee_ai_analysis_from_context(context)[0], calls


def comment_handles(facts):
    return [handle for description, handle in facts.items() if "One colleague's written comment" in description]


def test_themes_count_distinct_colleagues_and_quotes_are_rejected(db, monkeypatch):
    world = World(db, ["Anna", "Béla", "Cecil", "Dóra"])
    _anna, bela, cecil, dora = world.people
    world.review(bela, 4, "Always meets deadlines and keeps the team informed about progress.")
    world.review(cecil, 4, "Reliable, delivers on time.")
    world.review(dora, 2, "Quiet in meetings.")

    def answer(label, reasoning):
        def build(facts):
            handles = comment_handles(facts)
            peer = next(handle for description, handle in facts.items() if description.startswith("peer feedback on"))
            return GeneratedAnalysis(
                overall_assessment=GeneratedFinding(assessment="Dependable colleague", reasoning=reasoning, fact_ids=[peer, *handles[:2]]),
                strengths=[], development_areas=[],
                themes=[GeneratedTheme(label=label, tone="positive", fact_ids=handles)])
        return build

    quoted = answer("Keeps deadlines", "Colleagues say she always meets deadlines and keeps the team informed.")
    clean = answer("Dependable delivery", "Peer feedback describes a colleague who delivers on time.")
    analysis, calls = generate(db, world, [quoted, clean], monkeypatch)
    assert calls == [None, "verbatim_quote"]
    assert analysis.comment_authors == 3
    assert (analysis.themes[0].label, analysis.themes[0].mentions) == ("Dependable delivery", 3)
    assert analysis.overall_assessment.comment_mentions == 2

    with pytest.raises(ai_generation_service.AnalysisGenerationError) as error:
        generate(db, world, [quoted], monkeypatch)
    assert error.value.category == "correction_failed"


def test_themes_may_only_cite_comments(db, monkeypatch):
    world = World(db, ["Anna", "Béla", "Cecil"])
    world.review(world.people[1], 4, "Helpful.")
    world.review(world.people[2], 4, "Kind.")

    def build(facts):
        peer = next(handle for description, handle in facts.items() if description.startswith("peer feedback on"))
        return GeneratedAnalysis(overall_assessment=GeneratedFinding(assessment="Positive", reasoning="Peer feedback is positive.", fact_ids=[peer]),
                                 strengths=[], development_areas=[], themes=[GeneratedTheme(label="Rated well", tone="positive", fact_ids=[peer])])
    with pytest.raises(ai_generation_service.AnalysisGenerationError) as error:
        generate(db, world, [build], monkeypatch)
    assert error.value.category == "correction_failed"


def test_translation_must_match_item_for_item_without_numbers_or_quotes():
    finding = {"assessment": "Dependable", "reasoning": "Delivers on time.", "supporting_evidence_ids": ["e1"], "fact_ids": ["f1"]}
    analysis = EmployeeAIAnalysis.model_validate({
        "overall_assessment": finding, "strengths": [finding], "development_areas": [],
        "themes": [{"label": "On time", "tone": "positive", "fact_ids": ["f1"], "supporting_evidence_ids": ["e1"], "mentions": 2}]})
    good = TranslatedAnalysis(overall_assessment=TranslatedFinding(assessment="Megbízható", reasoning="Időben teljesít."),
                              strengths=[TranslatedFinding(assessment="Megbízható", reasoning="Időben teljesít.")],
                              development_areas=[], themes=["Határidők tartása"])
    translated = ai_generation_service._apply_translation(analysis, good, "hu", [])
    assert (translated.language, translated.themes[0].label, translated.themes[0].mentions) == ("hu", "Határidők tartása", 2)

    for broken, category in [
        (good.model_copy(update={"themes": []}), "translation_mismatch"),
        (good.model_copy(update={"themes": ["Három kolléga, 3"]}), "translation_number"),
        (good.model_copy(update={"themes": ["mindig időben leadja a feladatait a csapatnak"]}), "translation_quote"),
    ]:
        with pytest.raises(ai_generation_service.AnalysisGenerationError) as error:
            ai_generation_service._apply_translation(analysis, broken, "hu", ["Mindig időben leadja a feladatait a csapatnak."])
        assert error.value.category == category
