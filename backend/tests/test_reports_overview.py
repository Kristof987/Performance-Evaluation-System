import unittest
from datetime import date, timedelta
from uuid import uuid4

from fastapi import HTTPException

import models
from database import SessionLocal
from main import get_campaign_report_employee_detail, get_campaign_report_employees, get_campaign_report_group_detail, get_campaign_report_groups, get_campaign_report_overview, get_campaign_report_role_detail, get_campaign_report_roles, get_report_campaigns
from reporting_service import RatingResponse, average_by_evaluatee, average_by_reviewer, build_self_peer_comparison, employee_dimension_stats


def get_or_create_status(db, name):
    status = db.query(models.FormStatus).filter(models.FormStatus.name == name).first()
    if status is None:
        status = models.FormStatus(name=name)
        db.add(status)
        db.flush()
    return status


def get_or_create_role(db, name):
    role = db.query(models.CompanyRole).filter(models.CompanyRole.name == name).first()
    if role is None:
        role = models.CompanyRole(name=name)
        db.add(role)
        db.flush()
    return role


class ReportsOverviewTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        self.not_started = get_or_create_status(self.db, "Not started")
        self.in_progress = get_or_create_status(self.db, "In progress")
        self.completed = get_or_create_status(self.db, "Completed")
        self.hr_role = get_or_create_role(self.db, "HR")
        employee_role = models.CompanyRole(name=f"Reports employee {suffix}")
        system_role = models.SystemRole(name=f"Reports system {suffix}")
        self.db.add_all([employee_role, system_role])
        self.db.flush()
        self.hr = models.User(username=f"reports-hr-{suffix}", email=f"reports-hr-{suffix}@example.com", password_hash="test", company_role_id=self.hr_role.id, system_role_id=system_role.id, is_active=True)
        self.employee_a = models.User(username=f"reports-a-{suffix}", email=f"reports-a-{suffix}@example.com", password_hash="test", company_role_id=employee_role.id, system_role_id=system_role.id, is_active=True)
        self.employee_b = models.User(username=f"reports-b-{suffix}", email=f"reports-b-{suffix}@example.com", password_hash="test", company_role_id=employee_role.id, system_role_id=system_role.id, is_active=True)
        self.employee_c = models.User(username=f"reports-c-{suffix}", email=f"reports-c-{suffix}@example.com", password_hash="test", company_role_id=employee_role.id, system_role_id=system_role.id, is_active=True)
        self.db.add_all([self.hr, self.employee_a, self.employee_b, self.employee_c])
        self.db.flush()
        self.group_a = models.CompanyGroup(name=f"Reports group A {suffix}")
        self.group_b = models.CompanyGroup(name=f"Reports group B {suffix}")
        self.db.add_all([self.group_a, self.group_b])
        self.db.flush()
        self.db.execute(models.user_company_groups.insert(), [
            {"user_id": self.employee_a.id, "company_group_id": self.group_a.id},
            {"user_id": self.employee_b.id, "company_group_id": self.group_a.id},
            {"user_id": self.employee_b.id, "company_group_id": self.group_b.id},
            {"user_id": self.employee_c.id, "company_group_id": self.group_b.id},
        ])
        self.campaign = models.Campaign(name=f"Reports campaign {suffix}", start_date=date.today() - timedelta(days=10), end_date=date.today() + timedelta(days=10), created_by=self.hr.id, is_active=True)
        self.empty_campaign = models.Campaign(name=f"Reports empty {suffix}", start_date=date.today(), end_date=None, created_by=self.hr.id, is_active=True)
        self.db.add_all([self.campaign, self.empty_campaign])
        self.db.flush()
        self.db.execute(models.campaign_company_groups.insert(), [
            {"campaign_id": self.campaign.id, "company_group_id": self.group_a.id},
            {"campaign_id": self.campaign.id, "company_group_id": self.group_b.id},
        ])
        self.form = models.Form(name=f"Reports peer form {suffix}", questions=[
            {"id": "communication", "text": "Communicates clearly", "type": "Scale 1-5", "required": True, "dimension": {"id": "communication", "name": "Communication"}, "scale_direction": "higher_is_better"},
            {"id": "leadership", "text": "Leads effectively", "type": "Scale 1-5", "required": False, "dimension": {"id": "leadership", "name": "Leadership"}, "scale_direction": "higher_is_better"},
            {"id": "bad-scale", "text": "Different scale", "type": "Scale 1-10", "required": False, "dimension": {"id": "communication", "name": "Communication"}, "scale_direction": "higher_is_better"},
            {"id": "text", "text": "Comment", "type": "Text", "required": False},
        ])
        self.self_form = models.Form(name=f"Reports self form {suffix}", questions=[{"id": "self", "text": "Self score", "type": "Scale 1-5", "required": True, "dimension": {"id": "communication", "name": "Communication"}}])
        self.db.add_all([self.form, self.self_form])
        self.db.flush()
        self.rows = [
            models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_b.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "communication", "value": 4}, {"question_id": "leadership", "value": 5}, {"question_id": "bad-scale", "value": 8}, {"question_id": "text", "value": "private feedback"}]),
            models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_c.id, evaluatee_id=self.employee_b.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "communication", "value": 2}, {"question_id": "leadership", "value": 3}, {"question_id": "bad-scale", "value": 12}]),
            models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_b.id, evaluator_id=self.employee_a.id, evaluatee_id=self.employee_c.id, form_id=self.form.id, status_id=self.in_progress.id, finish_date=None, answers=[{"question_id": "communication", "value": 5}]),
            models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_b.id, evaluator_id=self.employee_a.id, evaluatee_id=self.employee_a.id, form_id=self.self_form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "self", "value": 1}]),
        ]
        self.db.add_all(self.rows)
        self.db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=self.campaign.id, employee_id=self.employee_a.id, form_id=self.self_form.id))
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def report(self, **overrides):
        params = {"campaign_id": self.campaign.id, "requester_user_id": self.hr.id, "db": self.db}
        params.update(overrides)
        return get_campaign_report_overview(**params)

    def test_kpis_dimensions_distribution_groups_and_employees(self):
        result = self.report()
        self.assertEqual(result["kpis"]["total_evaluations"], 4)
        self.assertEqual(result["kpis"]["completed_evaluations"], 3)
        self.assertEqual(result["kpis"]["completion_rate"], 75)
        self.assertEqual(result["kpis"]["submitted_evaluations"], 3)
        self.assertEqual(result["kpis"]["employees_evaluated"], 2)
        self.assertEqual(result["kpis"]["overall_score"], 4)
        self.assertEqual([dimension["name"] for dimension in result["dimensions"]], ["Leadership"])
        distribution = next(source for source in result["rating_distribution_sources"] if source["label"] == "Leadership")
        self.assertEqual(distribution["buckets"], [{"rating": 1, "count": 0}, {"rating": 2, "count": 0}, {"rating": 3, "count": 1}, {"rating": 4, "count": 0}, {"rating": 5, "count": 1}])
        group_a = next(group for group in result["groups"] if group["group_id"] == self.group_a.id)
        self.assertEqual(group_a["employee_count"], 2)
        self.assertEqual(group_a["completion_rate"], 100)
        self.assertEqual(group_a["average_score"], 4)
        self.assertEqual(result["employees"]["participating_employees"], 3)
        self.assertEqual(result["employees"]["employees_with_completed_peer_feedback"], 2)
        self.assertEqual(result["employees"]["employees_awaiting_peer_feedback"], 1)
        self.assertEqual(result["employees"]["configured_self_evaluations"], 1)
        self.assertEqual(result["employees"]["completed_self_evaluations"], 1)
        self.assertNotIn("private feedback", str(result))

    def test_zero_evaluations_and_authorization(self):
        empty = self.report(campaign_id=self.empty_campaign.id)
        self.assertEqual(empty["kpis"]["total_evaluations"], 0)
        self.assertEqual(empty["kpis"]["completion_rate"], 0)
        self.assertIsNone(empty["kpis"]["overall_score"])
        self.assertEqual(empty["dimensions"], [])
        campaigns = get_report_campaigns(requester_user_id=self.hr.id, db=self.db)
        self.assertTrue(any(campaign["id"] == self.campaign.id for campaign in campaigns))
        with self.assertRaises(HTTPException) as unauthorized:
            self.report(requester_user_id=self.employee_a.id)
        self.assertEqual(unauthorized.exception.status_code, 403)
        with self.assertRaises(HTTPException) as missing:
            self.report(campaign_id=999999999)
        self.assertEqual(missing.exception.status_code, 404)

    def test_evaluatee_balanced_aggregation_with_uneven_review_counts(self):
        campaign = models.Campaign(name="Uneven reports campaign", start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=5), created_by=self.hr.id, is_active=True)
        self.db.add(campaign)
        self.db.flush()
        rows = [
            models.FilledForm(campaign_id=campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_b.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 5}]),
            models.FilledForm(campaign_id=campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_c.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 5}]),
            models.FilledForm(campaign_id=campaign.id, company_group_id=self.group_a.id, evaluator_id=self.hr.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 5}]),
            models.FilledForm(campaign_id=campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_a.id, evaluatee_id=self.employee_b.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 1}]),
        ]
        self.db.add_all(rows)
        self.db.flush()
        result = self.report(campaign_id=campaign.id)
        leadership = next(dimension for dimension in result["dimensions"] if dimension["name"] == "Leadership")
        self.assertEqual(leadership["average_score"], 3)

    def test_phase_two_group_and_role_reports(self):
        groups = get_campaign_report_groups(campaign_id=self.campaign.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(groups["kpis"]["groups_in_campaign"], 2)
        self.assertEqual(groups["kpis"]["participating_employees"], 3)
        detail = get_campaign_report_group_detail(campaign_id=self.campaign.id, group_id=self.group_a.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["group"]["name"], self.group_a.name)
        self.assertTrue(any(employee["employee_name"] == self.employee_a.username for employee in detail["employees"]))
        roles = get_campaign_report_roles(campaign_id=self.campaign.id, requester_user_id=self.hr.id, perspective="evaluatee", db=self.db)
        self.assertTrue(any(role["completed_evaluations"] >= 2 for role in roles["roles"]))
        evaluator_roles = get_campaign_report_roles(campaign_id=self.campaign.id, requester_user_id=self.hr.id, perspective="evaluator", db=self.db)
        self.assertEqual(evaluator_roles["perspective"], "evaluator")
        self.assertEqual(roles["kpis"]["participating_employees"], 3)
        self.assertEqual(evaluator_roles["kpis"]["participating_employees"], 3)
        role_id = roles["roles"][0]["role_id"]
        role_detail = get_campaign_report_role_detail(campaign_id=self.campaign.id, role_id=role_id, requester_user_id=self.hr.id, perspective="evaluatee", db=self.db)
        self.assertIn("dimensions", role_detail)

    def test_group_reports_preserve_groups_before_scores_exist(self):
        suffix = uuid4().hex
        campaign = models.Campaign(name=f"Group visibility {suffix}", start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=5), created_by=self.hr.id, is_active=True)
        no_assignment_group = models.CompanyGroup(name=f"No assignments {suffix}")
        incomplete_group = models.CompanyGroup(name=f"Incomplete assignments {suffix}")
        completed_text_group = models.CompanyGroup(name=f"Completed text only {suffix}")
        text_form = models.Form(name=f"Text only {suffix}", questions=[{"id": "text", "text": "Comment", "type": "Text", "required": False}])
        self.db.add_all([campaign, no_assignment_group, incomplete_group, completed_text_group, text_form])
        self.db.flush()
        self.db.execute(models.campaign_company_groups.insert(), [
            {"campaign_id": campaign.id, "company_group_id": no_assignment_group.id},
            {"campaign_id": campaign.id, "company_group_id": incomplete_group.id},
            {"campaign_id": campaign.id, "company_group_id": completed_text_group.id},
        ])
        self.db.add_all([
            models.FilledForm(campaign_id=campaign.id, company_group_id=incomplete_group.id, evaluator_id=self.employee_a.id, evaluatee_id=self.employee_b.id, form_id=self.form.id, status_id=self.not_started.id, finish_date=None, answers=[]),
            models.FilledForm(campaign_id=campaign.id, company_group_id=completed_text_group.id, evaluator_id=self.employee_a.id, evaluatee_id=self.employee_b.id, form_id=text_form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "text", "value": "done"}]),
        ])
        self.db.flush()

        result = get_campaign_report_groups(campaign_id=campaign.id, requester_user_id=self.hr.id, db=self.db)
        by_name = {group["group_name"]: group for group in result["groups"]}
        self.assertEqual(set(by_name), {no_assignment_group.name, incomplete_group.name, completed_text_group.name})
        self.assertEqual(by_name[no_assignment_group.name]["total_evaluations"], 0)
        self.assertIsNone(by_name[no_assignment_group.name]["completion_rate"])
        self.assertEqual(by_name[incomplete_group.name]["completed_evaluations"], 0)
        self.assertEqual(by_name[incomplete_group.name]["total_evaluations"], 1)
        self.assertEqual(by_name[incomplete_group.name]["completion_rate"], 0)
        self.assertEqual(by_name[completed_text_group.name]["completed_evaluations"], 1)
        self.assertIsNone(by_name[completed_text_group.name]["average_score"])

    def test_role_reports_use_company_roles_not_system_roles(self):
        suffix = uuid4().hex
        company_role = models.CompanyRole(name=f"Company Analyst {suffix}")
        misleading_system_role = models.SystemRole(name=f"System Only Role {suffix}")
        self.db.add_all([company_role, misleading_system_role])
        self.db.flush()
        user = models.User(username=f"system-role-only-{suffix}", email=f"system-role-only-{suffix}@example.com", password_hash="test", company_role_id=company_role.id, system_role_id=misleading_system_role.id, is_active=True)
        self.db.add(user)
        self.db.flush()
        self.db.add(models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_a.id, evaluatee_id=user.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 4}]))
        self.db.flush()

        roles = get_campaign_report_roles(campaign_id=self.campaign.id, requester_user_id=self.hr.id, perspective="evaluatee", db=self.db)
        names = {role["role_name"] for role in roles["roles"]}
        self.assertIn(company_role.name, names)
        self.assertNotIn(misleading_system_role.name, names)

    def test_employee_reports_overview_detail_and_privacy(self):
        overview = get_campaign_report_employees(campaign_id=self.campaign.id, requester_user_id=self.hr.id, db=self.db)
        employee_a = next(employee for employee in overview["employees"] if employee["employee_id"] == self.employee_a.id)
        self.assertNotEqual(employee_a["company_role"], "HR")
        self.assertEqual(employee_a["peer_assigned"], 1)
        self.assertEqual(employee_a["peer_completed"], 1)
        self.assertEqual(employee_a["self_evaluation"]["status"], "Completed")
        self.assertIsNone(employee_a["performance_summary"]["average_score"])
        self.assertTrue(employee_a["performance_summary"]["suppressed"])
        employee_b = next(employee for employee in overview["employees"] if employee["employee_id"] == self.employee_b.id)
        self.assertEqual(employee_b["groups"].count(self.group_a.name), 1)

        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_a.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["employee"]["id"], self.employee_a.id)
        self.assertEqual(detail["coverage"]["peer_assigned"], 1)
        self.assertEqual(detail["dimension_availability"], "suppressed")
        self.assertTrue(all(dimension["average_score"] is None for dimension in detail["dimensions"]))
        self.assertNotIn("private feedback", str(detail))
        self.assertNotIn(str(self.employee_b.id), str(detail["dimensions"]))
        self.assertNotIn("private feedback", str(detail))
        self.assertNotIn("average_score': 4", str(detail))

        second_review = models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.hr.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 4}])
        self.db.add(second_review)
        self.db.flush()
        reportable = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_a.id, requester_user_id=self.hr.id, db=self.db)
        leadership = next(dimension for dimension in reportable["dimensions"] if dimension["name"] == "Leadership")
        self.assertEqual(leadership["average_score"], 4.5)
        self.assertEqual(leadership["evaluator_count"], 2)
        self.assertEqual(reportable["dimension_availability"], "available")

    def test_employee_dimension_availability_distinguishes_no_submission_and_no_dimensions(self):
        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_c.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["dimension_availability"], "not_submitted")
        self.assertEqual(detail["coverage"]["self_evaluation"]["status"], "Not assigned")

        self_row = models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_c.id, evaluatee_id=self.employee_c.id, form_id=self.self_form.id, status_id=self.not_started.id, finish_date=None, answers=[])
        self.db.add(self_row)
        self.db.flush()
        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_c.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["coverage"]["self_evaluation"]["status"], "Not started")
        self_row.status_id = self.in_progress.id
        self.db.flush()
        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_c.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["coverage"]["self_evaluation"]["status"], "In progress")

        text_form = models.Form(name=f"No dimensions {uuid4().hex}", questions=[{"id": "comment", "type": "Text", "required": False}])
        self.db.add(text_form)
        self.db.flush()
        self.db.add(models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_b.id, evaluatee_id=self.employee_c.id, form_id=text_form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "comment", "value": "submitted"}]))
        self.db.flush()
        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_c.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(detail["dimension_availability"], "no_dimensions")

    def test_reviewer_count_is_distinct_people_not_question_count(self):
        responses = [
            RatingResponse(i, 10, 20, None, 1, f"q{i}", "Question", value, 1, 5, "higher_is_better", "teamwork", "Teamwork")
            for i, value in enumerate((5, 4, 3), 1)
        ]
        stats = employee_dimension_stats(responses)
        self.assertEqual(len(stats), 1)
        self.assertTrue(stats[0]["suppressed"])
        self.assertIsNone(stats[0]["average_score"])
        self.assertEqual(stats[0]["evaluator_count"], 0)

    def test_employee_balanced_aggregation_is_separate_from_privacy(self):
        responses = [
            RatingResponse(1, 10, 20, None, 1, "q", "Question", 5, 1, 5, "higher_is_better", "quality", "Quality"),
            RatingResponse(2, 10, 21, None, 1, "q", "Question", 4, 1, 5, "higher_is_better", "quality", "Quality"),
            RatingResponse(3, 10, 22, None, 1, "q", "Question", 3, 1, 5, "higher_is_better", "quality", "Quality"),
            RatingResponse(4, 11, 20, None, 1, "q", "Question", 2, 1, 5, "higher_is_better", "quality", "Quality"),
        ]
        self.assertEqual(average_by_reviewer(responses[:3]), 4)
        self.assertEqual(average_by_reviewer(responses[3:]), 2)
        self.assertEqual(average_by_evaluatee(responses), 3)

    def test_self_peer_comparison_requires_same_dimension_and_scale_direction(self):
        peer = [{"id": "quality", "name": "Quality", "average_score": 4, "suppressed": False, "scale_min": 1, "scale_max": 5, "direction": "higher_is_better"}]
        self_side = [{"id": "quality", "name": "Quality", "average_score": 2, "scale_min": 1, "scale_max": 5, "direction": "lower_is_better"}]
        self.assertEqual(build_self_peer_comparison(peer, self_side), [])
        self_side[0]["direction"] = "higher_is_better"
        self.assertEqual(build_self_peer_comparison(peer, self_side)[0]["difference"], -2)
        peer[0]["suppressed"] = True
        self.assertEqual(build_self_peer_comparison(peer, self_side), [])

    def test_employee_detail_enforces_report_access_and_campaign_population(self):
        with self.assertRaises(HTTPException) as unauthorized:
            get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_a.id, requester_user_id=self.employee_a.id, db=self.db)
        self.assertEqual(unauthorized.exception.status_code, 403)
        with self.assertRaises(HTTPException) as outside_population:
            get_campaign_report_employee_detail(campaign_id=self.empty_campaign.id, employee_id=self.employee_a.id, requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(outside_population.exception.status_code, 404)

    def test_employee_report_history_requires_compatible_multiple_campaigns(self):
        past_campaign = models.Campaign(name="Past employee report", start_date=date.today() - timedelta(days=400), end_date=date.today() - timedelta(days=370), created_by=self.hr.id, is_active=True)
        self.db.add(past_campaign)
        self.db.flush()
        self.db.add_all([
            models.FilledForm(campaign_id=past_campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_b.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=past_campaign.end_date, answers=[{"question_id": "leadership", "value": 3}]),
            models.FilledForm(campaign_id=past_campaign.id, company_group_id=self.group_a.id, evaluator_id=self.employee_c.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=past_campaign.end_date, answers=[{"question_id": "leadership", "value": 5}]),
            models.FilledForm(campaign_id=self.campaign.id, company_group_id=self.group_a.id, evaluator_id=self.hr.id, evaluatee_id=self.employee_a.id, form_id=self.form.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"question_id": "leadership", "value": 4}]),
        ])
        self.db.flush()
        detail = get_campaign_report_employee_detail(campaign_id=self.campaign.id, employee_id=self.employee_a.id, requester_user_id=self.hr.id, db=self.db)
        leadership_history = next(series for series in detail["history"] if series["dimension_name"] == "Leadership")
        self.assertEqual(len(leadership_history["points"]), 2)


if __name__ == '__main__':
    unittest.main()
