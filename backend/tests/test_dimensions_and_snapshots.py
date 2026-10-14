import unittest
from datetime import date, timedelta
from uuid import uuid4

from fastapi import HTTPException

import models
from database import SessionLocal
from main import (
    create_performance_dimension,
    get_assigned_questionnaire,
    get_campaign_report_overview,
    get_performance_dimensions,
    update_assigned_questionnaire,
    update_campaign_evaluation_matrix,
    update_performance_dimension,
)
import schemas


def status(db, name):
    row = db.query(models.FormStatus).filter(models.FormStatus.name == name).first()
    if row is None:
        row = models.FormStatus(name=name)
        db.add(row)
        db.flush()
    return row


def role(db, name):
    row = db.query(models.CompanyRole).filter(models.CompanyRole.name == name).first()
    if row is None:
        row = models.CompanyRole(name=name)
        db.add(row)
        db.flush()
    return row


class DimensionAndSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        self.not_started = status(self.db, "Not started")
        self.completed = status(self.db, "Completed")
        self.hr_role = role(self.db, "HR")
        self.employee_role = role(self.db, f"Snapshot employee {suffix}")
        self.system_role = models.SystemRole(name=f"Snapshot system {suffix}")
        self.db.add(self.system_role)
        self.db.flush()
        self.hr = models.User(username=f"snapshot-hr-{suffix}", email=f"snapshot-hr-{suffix}@example.com", password_hash="x", company_role_id=self.hr_role.id, system_role_id=self.system_role.id, is_active=True)
        self.a = models.User(username=f"snapshot-a-{suffix}", email=f"snapshot-a-{suffix}@example.com", password_hash="x", company_role_id=self.employee_role.id, system_role_id=self.system_role.id, is_active=True)
        self.b = models.User(username=f"snapshot-b-{suffix}", email=f"snapshot-b-{suffix}@example.com", password_hash="x", company_role_id=self.employee_role.id, system_role_id=self.system_role.id, is_active=True)
        self.db.add_all([self.hr, self.a, self.b])
        self.db.flush()
        self.group = models.CompanyGroup(name=f"Snapshot group {suffix}")
        self.db.add(self.group)
        self.db.flush()
        self.db.execute(models.user_company_groups.insert(), [{"user_id": self.a.id, "company_group_id": self.group.id}, {"user_id": self.b.id, "company_group_id": self.group.id}])
        self.dimension = create_performance_dimension(schemas.PerformanceDimensionCreate(name=f"Communication {suffix}", description=""), requester_user_id=self.hr.id, db=self.db)
        self.form = models.Form(name=f"Snapshot form {suffix}", questions=[{"id": "q1", "text": "Original rating", "type": "Scale 1-5", "required": True, "dimension_id": self.dimension.id, "dimension": {"id": self.dimension.id, "name": self.dimension.name}, "scale_direction": "higher_is_better"}])
        self.db.add(self.form)
        self.db.flush()
        self.campaign = models.Campaign(name=f"Snapshot campaign {suffix}", start_date=date.today() - timedelta(days=1), end_date=date.today() + timedelta(days=30), created_by=self.hr.id, is_active=True)
        self.db.add(self.campaign)
        self.db.flush()
        self.db.execute(models.campaign_company_groups.insert(), [{"campaign_id": self.campaign.id, "company_group_id": self.group.id}])
        self.db.add(models.CampaignEvaluationRule(campaign_id=self.campaign.id, company_group_id=self.group.id, evaluator_role_id=self.employee_role.id, evaluatee_role_id=self.employee_role.id, form_id=self.form.id))
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def issue(self):
        return update_campaign_evaluation_matrix(self.campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=[
            schemas.CampaignEvaluationMatrixUpdateItem(company_group_id=self.group.id, evaluator_id=self.a.id, evaluatee_id=self.b.id),
            schemas.CampaignEvaluationMatrixUpdateItem(company_group_id=self.group.id, evaluator_id=self.b.id, evaluatee_id=self.a.id),
        ]), self.db)

    def test_dimension_crud_authorization_and_duplicate_validation(self):
        dimensions = get_performance_dimensions(requester_user_id=self.hr.id, include_inactive=True, db=self.db)
        self.assertTrue(any(item.id == self.dimension.id for item in dimensions))
        with self.assertRaises(HTTPException) as unauthorized:
            get_performance_dimensions(requester_user_id=self.a.id, include_inactive=True, db=self.db)
        self.assertEqual(unauthorized.exception.status_code, 403)
        with self.assertRaises(HTTPException) as duplicate:
            create_performance_dimension(schemas.PerformanceDimensionCreate(name=self.dimension.name.upper(), description=None), requester_user_id=self.hr.id, db=self.db)
        self.assertEqual(duplicate.exception.status_code, 400)
        archived = update_performance_dimension(self.dimension.id, schemas.PerformanceDimensionUpdate(name=self.dimension.name, description="Archived", is_active=False), requester_user_id=self.hr.id, db=self.db)
        self.assertFalse(archived.is_active)

    def test_issued_snapshot_survives_form_edits_and_reports_use_snapshot(self):
        self.issue()
        filled_form = self.db.query(models.FilledForm).filter(models.FilledForm.campaign_id == self.campaign.id, models.FilledForm.evaluator_id == self.a.id).first()
        self.assertEqual(filled_form.snapshot_status, "verified")
        self.assertEqual(filled_form.form_snapshot["questions"][0]["text"], "Original rating")

        self.form.questions = [{"id": "q1", "text": "Changed rating", "type": "Scale 1-10", "required": True, "dimension_id": self.dimension.id, "dimension": {"id": self.dimension.id, "name": self.dimension.name}}]
        self.db.flush()

        questionnaire = get_assigned_questionnaire(self.a.id, filled_form.id, self.db)
        self.assertEqual(questionnaire["questions"][0]["text"], "Original rating")
        self.assertEqual(questionnaire["questions"][0]["type"], "Scale 1-5")

        update_assigned_questionnaire(self.a.id, filled_form.id, schemas.AssignedQuestionnaireUpdate(answers=[{"question_id": "q1", "value": 5}], submit=False), self.db)
        update_assigned_questionnaire(self.a.id, filled_form.id, schemas.AssignedQuestionnaireUpdate(answers=[{"question_id": "q1", "value": 5}], submit=True), self.db)
        other = self.db.query(models.FilledForm).filter(models.FilledForm.campaign_id == self.campaign.id, models.FilledForm.evaluator_id == self.b.id).first()
        update_assigned_questionnaire(self.b.id, other.id, schemas.AssignedQuestionnaireUpdate(answers=[{"question_id": "q1", "value": 3}], submit=True), self.db)
        report = get_campaign_report_overview(self.campaign.id, self.hr.id, self.db)
        self.assertEqual(report["kpis"]["submitted_evaluations"], 2)
        self.assertEqual(report["dimensions"][0]["name"], self.dimension.name)
        self.assertEqual(report["dimensions"][0]["average_score"], 4)


if __name__ == '__main__':
    unittest.main()
