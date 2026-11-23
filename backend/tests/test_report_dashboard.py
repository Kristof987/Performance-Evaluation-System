from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

import models
from services import report_dashboard_service
from services import reporting_service
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


@pytest.fixture
def permissions(monkeypatch):
    granted = {"reports.read", "campaigns.manage"}
    monkeypatch.setattr(reporting_service, "_has_permission", lambda _actor, _db, permission: permission in granted)
    return granted


def add(db, item):
    db.add(item)
    db.flush()
    return item


class World:
    def __init__(self, db):
        self.db = db
        suffix = uuid4().hex
        system_role = db.query(models.SystemRole).first() or add(db, models.SystemRole(name=f"Role {suffix}"))
        self.role = add(db, models.CompanyRole(name=f"Dashboard role {suffix}"))
        self.actor = add(db, models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="",
                                         system_role_id=system_role.id, is_active=True))
        self.done = db.query(models.FormStatus).filter(models.FormStatus.name == "Completed").first() or add(db, models.FormStatus(name="Completed"))
        self.open = db.query(models.FormStatus).filter(models.FormStatus.name == "Not started").first() or add(db, models.FormStatus(name="Not started"))
        self.section_a = add(db, models.Section(scope_key="default", name=f"Alpha {suffix}", normalized_name=f"alpha {suffix}"))
        self.section_b = add(db, models.Section(scope_key="default", name=f"Beta {suffix}", normalized_name=f"beta {suffix}"))
        self.form = add(db, models.Form(name=f"Form {suffix}", questions=[]))
        self.groups = [add(db, models.CompanyGroup(name=f"{name} {suffix}")) for name in ("Sales", "Support")]
        self.people = [self.person(suffix, index) for index in range(6)]
        members = [(self.groups[0], self.people[:3]), (self.groups[1], self.people[3:])]
        db.execute(models.employee_company_groups.insert(), [
            {"employee_id": person.id, "company_group_id": group.id} for group, people in members for person in people])

    def person(self, suffix, index):
        user = add(self.db, models.User(username=f"p{index}-{suffix}", email=f"p{index}-{suffix}@example.com", password_hash="",
                                        system_role_id=self.actor.system_role_id, is_active=True))
        return add(self.db, models.Employee(user_id=user.id, full_name=f"Person {index}", company_role_id=self.role.id, is_active=True))

    def campaign(self, year, status="closed"):
        item = add(self.db, models.Campaign(name=f"Campaign {year} {uuid4().hex[:6]}", status=status, is_active=False,
                                            start_date=datetime(year, 1, 1, tzinfo=timezone.utc), created_by=self.actor.id))
        self.db.execute(models.campaign_company_groups.insert(), [
            {"campaign_id": item.id, "company_group_id": group.id} for group in self.groups])
        return item

    def snapshot(self):
        return {"schema_version": 2, "questions": [
            {"type": "section", "section_id": section.id, "section": {"id": section.id, "name": section.name},
             "questions": [{"id": f"q{section.id}", "type": "Scale 1-5", "text": "How well?"}]}
            for section in (self.section_a, self.section_b)]}

    def review(self, campaign, group, evaluator, evaluatee, alpha, beta, *, completed=True):
        answers = [{"question_id": f"q{self.section_a.id}", "value": alpha}, {"question_id": f"q{self.section_b.id}", "value": beta}]
        add(self.db, models.FilledForm(campaign_id=campaign.id, form_id=self.form.id, company_group_id=group.id,
                                       evaluator_id=evaluator.id, evaluatee_id=evaluatee.id,
                                       status_id=(self.done if completed else self.open).id,
                                       finish_date=date(2091, 2, 1) if completed else None,
                                       answers=answers if completed else [], form_snapshot=self.snapshot()))

    def rate_everyone(self, campaign, alpha, beta):
        for group_index, group in enumerate(self.groups):
            people = self.people[group_index * 3:group_index * 3 + 3]
            for evaluator in people:
                for evaluatee in people:
                    if evaluator is not evaluatee:
                        self.review(campaign, group, evaluator, evaluatee, alpha[group_index], beta[group_index])


def test_dashboard_combines_matrix_deltas_and_trend(db, permissions):
    world = World(db)
    old = world.campaign(2090)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2091)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    world.review(current, world.groups[0], world.people[0], world.people[1], 1, 1, completed=False)
    world.campaign(2092, status="active")  # A later, still running campaign is not history.

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    assert result["previous_campaign"]["id"] == old.id
    assert result["completion"] == {"completed_evaluations": 12, "total_evaluations": 13, "rate": 92, "previous_rate": 100}
    alpha, beta = result["sections"]
    assert (alpha["id"], alpha["score"], alpha["previous_score"]) == (world.section_a.id, 4.0, 2.5)
    assert (beta["score"], beta["previous_score"]) == (3.0, 2.5)
    assert result["overall"]["score"] == 3.5 and result["overall"]["previous_score"] == 2.5
    sales, support = result["groups"]
    assert sales["completion_rate"] == 86 and support["completion_rate"] == 100
    assert sales["sections"][world.section_a.id] == {"score": 5.0, "availability": "available"}
    assert support["sections"][world.section_b.id]["score"] == 2.0
    assert sales["overall"]["score"] == 4.5 and sales["overall"]["previous_score"] == 3.0
    assert [point["campaign"]["id"] for point in result["trend"]] == [old.id, current.id]
    assert result["trend"][0]["groups"][world.groups[1].id] == 2.0
    assert result["trend"][1]["sections"][world.section_a.id] == 4.0
    assert result["trend"][0]["group_sections"][world.groups[0].id][world.section_b.id] == 3.0


def test_dashboard_applies_privacy_suppression(db, permissions):
    permissions.discard("campaigns.manage")
    world = World(db)
    current = world.campaign(2093)
    # Only one evaluated employee in Support: below the aggregate threshold.
    for evaluator in world.people[:3]:
        for evaluatee in world.people[:3]:
            if evaluator is not evaluatee:
                world.review(current, world.groups[0], evaluator, evaluatee, 4, 4)
    world.review(current, world.groups[1], world.people[4], world.people[3], 2, 2)
    world.review(current, world.groups[1], world.people[5], world.people[3], 2, 2)

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    support = result["groups"][1]
    assert support["overall"]["score"] is None and support["overall"]["availability"] == "suppressed"
    assert all(cell["score"] is None for cell in support["sections"].values())
    assert result["trend"][-1]["groups"][world.groups[1].id] is None
    assert set(result["trend"][-1]["group_sections"][world.groups[1].id].values()) == {None}
    assert result["previous_campaign"] is None and result["overall"]["previous_score"] is None


def test_section_questions_compare_groups_self_and_previous_campaign(db, permissions):
    world = World(db)
    old = world.campaign(2094)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2095)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    world.review(current, world.groups[0], world.people[0], world.people[0], 4, 4)

    result = report_dashboard_service.build_section_questions(current.id, world.section_a.id, [world.groups[1].id], world.actor, db)

    assert result["section"] == {"id": world.section_a.id, "name": world.section_a.name}
    assert result["previous_campaign"]["id"] == old.id
    assert result["groups"] == [{"id": world.groups[1].id, "name": world.groups[1].name}]
    (question,) = result["questions"]
    assert (question["average"], question["previous_average"], question["response_count"]) == (4.0, 2.5, 12)
    assert {key: question["self"][key] for key in ("availability", "response_count", "average")} == {"availability": "available", "response_count": 1, "average": 4.0}
    assert question["groups"][world.groups[1].id]["average"] == 3.0
    assert [bucket["count"] for bucket in question["groups"][world.groups[1].id]["distribution"]] == [0, 0, 6, 0, 0]
    assert [bucket["count"] for bucket in question["distribution"]] == [0, 0, 6, 0, 6]


def test_section_questions_validate_scope(db, permissions):
    from fastapi import HTTPException

    world = World(db)
    current = world.campaign(2096)
    world.rate_everyone(current, alpha=(4, 4), beta=(4, 4))
    with pytest.raises(HTTPException) as missing_group:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [10**9], world.actor, db)
    with pytest.raises(HTTPException) as missing_section:
        report_dashboard_service.build_section_questions(current.id, 10**9, [], world.actor, db)
    with pytest.raises(HTTPException) as too_many:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [1, 2, 3, 4, 5, 6], world.actor, db)
    assert (missing_group.value.status_code, missing_section.value.status_code, too_many.value.status_code) == (404, 404, 400)


def test_section_questions_keep_group_privacy(db, permissions):
    permissions.discard("campaigns.manage")
    world = World(db)
    current = world.campaign(2097)
    for evaluator in world.people[:3]:
        for evaluatee in world.people[:3]:
            if evaluator is not evaluatee:
                world.review(current, world.groups[0], evaluator, evaluatee, 4, 4)
    world.review(current, world.groups[1], world.people[4], world.people[3], 2, 2)
    world.review(current, world.groups[1], world.people[5], world.people[3], 2, 2)

    result = report_dashboard_service.build_section_questions(current.id, world.section_a.id, [world.groups[1].id], world.actor, db)

    support = result["questions"][0]["groups"][world.groups[1].id]
    assert support["availability"] == "suppressed" and support["average"] is None and support["distribution"] is None


def test_employee_overview_adds_sections_previous_scores_and_groups(db, permissions):
    world = World(db)
    old = world.campaign(2098)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2099)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    world.review(current, world.groups[0], world.people[0], world.people[0], 2, 2)

    result = reporting_service.build_employee_reports_overview(current.id, world.actor, db)

    assert result["previous_campaign"]["id"] == old.id
    assert [section["id"] for section in result["sections"]] == [world.section_a.id, world.section_b.id]
    assert result["groups"] == [{"id": group.id, "name": group.name} for group in world.groups]
    first = next(item for item in result["employees"] if item["employee_id"] == world.people[0].id)
    summary = first["performance_summary"]
    assert summary["overall_peer_score"] == 4.5 and summary["previous_overall_peer_score"] == 3.0
    assert summary["overall_self_score"] == 2.0
    assert summary["section_scores"] == {world.section_a.id: 5.0, world.section_b.id: 4.0}
    assert first["group_ids"] == [world.groups[0].id]


def test_employee_detail_compares_with_groups_campaign_and_previous(db, permissions):
    world = World(db)
    old = world.campaign(2100)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2101)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))

    result = reporting_service.build_employee_report_detail(current.id, world.people[3].id, world.actor, db)

    assert result["previous"] == {"overall_peer_score": 2.0, "sections": {world.section_a.id: 2.0, world.section_b.id: 2.0}}
    assert result["benchmarks"]["campaign"]["sections"][world.section_a.id] == 4.0
    (group,) = result["benchmarks"]["groups"]
    assert (group["id"], group["overall"], group["sections"][world.section_b.id]) == (world.groups[1].id, 2.5, 2.0)


def test_team_lead_employee_benchmarks_stay_inside_led_groups(db, permissions):
    world = World(db)
    current = world.campaign(2102)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    db.execute(models.employee_company_groups.insert().values(employee_id=world.people[0].id, company_group_id=world.groups[1].id))
    token = reporting_service._team_groups.set(frozenset({world.groups[0].id}))
    try:
        result = reporting_service.build_employee_report_detail(current.id, world.people[0].id, world.actor, db)
    finally:
        reporting_service._team_groups.reset(token)

    assert result["benchmarks"]["campaign"] is None
    assert [group["id"] for group in result["benchmarks"]["groups"]] == [world.groups[0].id]


def test_dashboard_compares_roles_and_rater_calibration(db, permissions):
    world = World(db)
    support_role = add(db, models.CompanyRole(name=f"Support role {uuid4().hex}"))
    for person in world.people[3:]:
        person.company_role_id = support_role.id
    db.flush()
    old = world.campaign(2098)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2099)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    roles = {item["id"]: item for item in result["roles"]}
    sales, support = roles[world.role.id], roles[support_role.id]
    assert (sales["employee_count"], sales["completed_evaluations"], sales["total_evaluations"]) == (3, 6, 6)
    assert sales["overall"]["score"] == 4.5 and sales["overall"]["previous_score"] == 3.0
    assert support["sections"][world.section_b.id] == {"score": 2.0, "availability": "available"}
    assert result["trend"][0]["roles"][support_role.id] == 2.0
    assert result["trend"][1]["role_sections"][world.role.id][world.section_a.id] == 5.0
    raters = {item["id"]: item for item in result["raters"]}
    assert raters[world.role.id]["overall"]["score"] == 4.5 and raters[world.role.id]["evaluator_count"] == 3
    assert raters[support_role.id]["overall"]["score"] == 2.5

    questions = report_dashboard_service.build_section_questions(current.id, world.section_a.id, [], world.actor, db, role_ids=[support_role.id])
    assert questions["dimension"] == "roles"
    assert questions["groups"] == [{"id": support_role.id, "name": support_role.name}]
    assert questions["questions"][0]["groups"][support_role.id]["average"] == 3.0

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as both:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [world.groups[0].id], world.actor, db, role_ids=[support_role.id])
    with pytest.raises(HTTPException) as unknown:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [], world.actor, db, role_ids=[10**9])
    assert (both.value.status_code, unknown.value.status_code) == (400, 404)


def test_group_detail_lists_member_scores(db, permissions):
    world = World(db)
    current = world.campaign(2100)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    world.review(current, world.groups[0], world.people[1], world.people[0], 1, 1, completed=False)

    result = reporting_service.build_group_detail(current.id, world.groups[0].id, world.actor, db)

    first = next(item for item in result["employees"] if item["employee_id"] == world.people[0].id)
    assert (first["reviews_received"], first["reviews_assigned"]) == (2, 3)
    assert (first["peer_score"], first["score_availability"]) == (4.5, "available")


def as_team_lead(permissions, monkeypatch, *group_ids):
    permissions.clear()
    permissions.add("reports.read_team")
    monkeypatch.setattr(reporting_service, "led_group_ids", lambda _actor, _db: frozenset(group_ids))


def test_team_lead_dashboard_covers_only_led_groups_with_company_reference(db, permissions, monkeypatch):
    world = World(db)
    old = world.campaign(2103)
    world.rate_everyone(old, alpha=(3, 2), beta=(3, 2))
    current = world.campaign(2104)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    as_team_lead(permissions, monkeypatch, world.groups[0].id)

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    assert [group["id"] for group in result["groups"]] == [world.groups[0].id]
    assert result["overall"]["score"] == 4.5 and result["overall"]["previous_score"] == 3.0
    assert result["completion"]["total_evaluations"] == 6
    assert [section["score"] for section in result["sections"]] == [5.0, 4.0]
    assert result["benchmark"]["overall"] == {"score": 3.5, "availability": "available"}
    assert {key: cell["score"] for key, cell in result["benchmark"]["sections"].items()} == {world.section_a.id: 4.0, world.section_b.id: 3.0}
    assert result["roles"] == [] and result["raters"] == []
    assert world.groups[1].id not in result["trend"][-1]["groups"]


def test_team_lead_combined_score_cannot_reveal_a_hidden_group(db, permissions, monkeypatch):
    world = World(db)
    current = world.campaign(2105)
    for evaluator in world.people[:3]:
        for evaluatee in world.people[:3]:
            if evaluator is not evaluatee:
                world.review(current, world.groups[0], evaluator, evaluatee, 4, 4)
    # Support has a single evaluated employee: hidden on its own, so the combined score must hide too.
    world.review(current, world.groups[1], world.people[4], world.people[3], 1, 1)
    world.review(current, world.groups[1], world.people[5], world.people[3], 1, 1)
    # A third, unled group keeps the campaign-wide complements large enough.
    ops = add(db, models.CompanyGroup(name=f"Ops {uuid4().hex}"))
    db.execute(models.campaign_company_groups.insert().values(campaign_id=current.id, company_group_id=ops.id))
    crew = [world.person(uuid4().hex, index) for index in range(3)]
    for evaluator in crew:
        for evaluatee in crew:
            if evaluator is not evaluatee:
                world.review(current, ops, evaluator, evaluatee, 3, 3)
    as_team_lead(permissions, monkeypatch, world.groups[0].id, world.groups[1].id)

    result = report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)

    support = result["groups"][1]
    assert support["overall"]["availability"] == "suppressed"
    assert result["overall"]["score"] is None and {section["availability"] for section in result["sections"]} == {"suppressed"}


def test_team_lead_campaign_views_stay_inside_led_groups(db, permissions, monkeypatch):
    from fastapi import HTTPException

    world = World(db)
    current = world.campaign(2106)
    world.rate_everyone(current, alpha=(5, 3), beta=(4, 2))
    outsider = add(db, models.CompanyGroup(name=f"Elsewhere {uuid4().hex}"))
    as_team_lead(permissions, monkeypatch, outsider.id)
    with pytest.raises(HTTPException) as foreign:
        report_dashboard_service.build_campaign_dashboard(current.id, world.actor, db)
    assert foreign.value.status_code == 404

    as_team_lead(permissions, monkeypatch, world.groups[0].id)
    own = report_dashboard_service.build_section_questions(current.id, world.section_a.id, [world.groups[0].id], world.actor, db)
    assert own["groups"] == [{"id": world.groups[0].id, "name": world.groups[0].name}]
    with pytest.raises(HTTPException) as other_group:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [world.groups[1].id], world.actor, db)
    with pytest.raises(HTTPException) as by_role:
        report_dashboard_service.build_section_questions(current.id, world.section_a.id, [], world.actor, db, role_ids=[world.role.id])
    assert (other_group.value.status_code, by_role.value.status_code) == (403, 403)


def test_team_scores_withhold_a_combination_that_isolates_one_led_group():
    from itertools import count
    from services.section_scoring_service import EvaluationSections

    ids = count(1)

    def reviews(group_id, evaluatees, score):
        return [EvaluationSections(next(ids), 1, evaluator, evaluatee, group_id, date(2090, 1, 1), frozenset({7}), {7: score}, {7: frozenset({"q7"})})
                for evaluatee in evaluatees for evaluator in (1000 + evaluatee, 2000 + evaluatee)]

    big, small, other = reviews(10, [1, 2, 3], 4.0), reviews(20, [4], 1.0), reviews(30, [5, 6, 7], 3.0)
    scored = big + small + other
    alone = report_dashboard_service._team_scores(scored, 1, frozenset({10}))
    together = report_dashboard_service._team_scores(scored, 1, frozenset({10, 20}))
    assert alone.sections[7].availability == "available"
    # Big and the combination together would reveal the single employee in the small group.
    assert together.sections[7].availability == "suppressed"
