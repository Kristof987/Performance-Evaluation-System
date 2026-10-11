import unittest
from datetime import date, timedelta
from uuid import uuid4

from fastapi import HTTPException

import models
from database import SessionLocal
from main import get_campaign_completion_status


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


class CompletionStatusTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        self.not_started = get_or_create_status(self.db, "Not started")
        self.in_progress = get_or_create_status(self.db, "In progress")
        self.completed = get_or_create_status(self.db, "Completed")
        self.hr_role = get_or_create_role(self.db, "HR")
        employee_role = models.CompanyRole(name=f"Completion employee {suffix}")
        system_role = models.SystemRole(name=f"Completion system {suffix}")
        self.form_a = models.Form(name=f"Peer review {suffix}", questions=[])
        self.form_b = models.Form(name=f"Self review {suffix}", questions=[])
        self.db.add_all([employee_role, system_role, self.form_a, self.form_b])
        self.db.flush()
        self.hr = models.User(username=f"hr-{suffix}", email=f"hr-{suffix}@example.com", password_hash="test", company_role_id=self.hr_role.id, system_role_id=system_role.id, is_active=True)
        self.employee = models.User(username=f"adam-{suffix}", email=f"adam-{suffix}@example.com", password_hash="test", company_role_id=employee_role.id, system_role_id=system_role.id, is_active=True)
        self.peer = models.User(username=f"sarah-{suffix}", email=f"sarah-{suffix}@example.com", password_hash="test", company_role_id=employee_role.id, system_role_id=system_role.id, is_active=True)
        self.db.add_all([self.hr, self.employee, self.peer])
        self.db.flush()
        self.campaign = models.Campaign(name=f"Completion campaign {suffix}", start_date=date.today() - timedelta(days=7), end_date=date.today() - timedelta(days=1), created_by=self.hr.id, is_active=True)
        self.empty_campaign = models.Campaign(name=f"Empty completion {suffix}", start_date=date.today(), end_date=date.today() + timedelta(days=7), created_by=self.hr.id, is_active=True)
        self.db.add_all([self.campaign, self.empty_campaign])
        self.db.flush()
        self.rows = [
            models.FilledForm(campaign_id=self.campaign.id, evaluator_id=self.employee.id, evaluatee_id=self.peer.id, form_id=self.form_a.id, status_id=self.not_started.id, finish_date=None, answers=[{"secret": "do not leak"}]),
            models.FilledForm(campaign_id=self.campaign.id, evaluator_id=self.peer.id, evaluatee_id=self.employee.id, form_id=self.form_a.id, status_id=self.in_progress.id, finish_date=None, answers=[{"secret": "do not leak"}]),
            models.FilledForm(campaign_id=self.campaign.id, evaluator_id=self.employee.id, evaluatee_id=self.employee.id, form_id=self.form_b.id, status_id=self.completed.id, finish_date=date.today(), answers=[{"secret": "do not leak"}]),
        ]
        self.db.add_all(self.rows)
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def request(self, **overrides):
        params = {
            "campaign_id": self.campaign.id,
            "requester_user_id": self.hr.id,
            "search": None,
            "status": None,
            "questionnaire_id": None,
            "overdue_only": False,
            "sort": "due_date",
            "order": "asc",
            "page": 1,
            "page_size": 25,
            "db": self.db,
        }
        params.update(overrides)
        return get_campaign_completion_status(**params)

    def test_summary_overdue_self_evaluation_and_no_answer_leakage(self):
        result = self.request()
        self.assertEqual(result["summary"]["total_evaluations"], 3)
        self.assertEqual(result["summary"]["not_started"], 1)
        self.assertEqual(result["summary"]["in_progress"], 1)
        self.assertEqual(result["summary"]["completed"], 1)
        self.assertEqual(result["summary"]["overdue"], 2)
        self.assertEqual(result["summary"]["completion_rate"], 33)
        self.assertTrue(any(row["is_self_evaluation"] for row in result["rows"]))
        self.assertNotIn("answers", str(result))
        self.assertNotIn("do not leak", str(result))

    def test_search_filters_pagination_and_zero_campaign(self):
        searched = self.request(search="sarah")
        self.assertEqual(searched["pagination"]["total_items"], 2)
        filtered = self.request(status="in_progress", questionnaire_id=self.form_a.id, overdue_only=True)
        self.assertEqual(filtered["pagination"]["total_items"], 1)
        self.assertEqual(filtered["rows"][0]["status_label"], "In progress")
        paged = self.request(sort="evaluator", order="asc", page_size=1, page=2)
        self.assertEqual(paged["pagination"], {"page": 2, "page_size": 1, "total_items": 3, "total_pages": 3})
        empty = self.request(campaign_id=self.empty_campaign.id)
        self.assertEqual(empty["summary"]["total_evaluations"], 0)
        self.assertEqual(empty["summary"]["completion_rate"], 0)

    def test_authorization_and_missing_campaign(self):
        with self.assertRaises(HTTPException) as unauthorized:
            self.request(requester_user_id=self.employee.id)
        self.assertEqual(unauthorized.exception.status_code, 403)
        with self.assertRaises(HTTPException) as missing:
            self.request(campaign_id=999999999)
        self.assertEqual(missing.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
