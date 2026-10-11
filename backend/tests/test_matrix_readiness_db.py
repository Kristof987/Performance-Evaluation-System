import unittest
from datetime import date
from uuid import uuid4

from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from main import build_campaign_evaluation_matrix, update_campaign_evaluation_matrix


class MatrixReadinessDatabaseTests(unittest.TestCase):
    def test_save_requires_complete_rules_and_preserves_issued_form(self):
        db = SessionLocal()
        # Exercise the real query/save path in one transaction; never commit test records.
        db.commit = db.flush
        suffix = uuid4().hex
        try:
            role = models.CompanyRole(name=f"Matrix role {suffix}")
            system_role = models.SystemRole(name=f"Matrix system role {suffix}")
            group = models.CompanyGroup(name=f"Matrix group {suffix}")
            form = models.Form(name=f"Matrix form {suffix}", questions=[])
            replacement = models.Form(name=f"Matrix replacement {suffix}", questions=[])
            db.add_all([role, system_role, group, form, replacement])
            db.flush()
            user = models.User(username=f"matrix-{suffix}", email=f"matrix-{suffix}@example.com", password_hash="test", company_role_id=role.id, system_role_id=system_role.id, is_active=True)
            db.add(user)
            db.flush()
            campaign = models.Campaign(name=f"Matrix campaign {suffix}", start_date=date.today(), is_active=True, created_by=user.id)
            db.add(campaign)
            db.flush()
            db.execute(models.user_company_groups.insert().values(user_id=user.id, company_group_id=group.id))
            db.execute(models.campaign_company_groups.insert().values(campaign_id=campaign.id, company_group_id=group.id))
            db.flush()

            payload = schemas.CampaignEvaluationMatrixUpdate(assignments=[
                schemas.CampaignEvaluationMatrixUpdateItem(company_group_id=group.id, evaluator_id=user.id, evaluatee_id=user.id)
            ])
            with self.assertRaises(HTTPException) as error:
                update_campaign_evaluation_matrix(campaign.id, payload, db)
            self.assertEqual(error.exception.status_code, 409)
            self.assertEqual(error.exception.detail["missing"], 1)
            self.assertEqual(db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign.id).count(), 0)

            rule = models.CampaignEvaluationRule(campaign_id=campaign.id, company_group_id=group.id, evaluator_role_id=role.id, evaluatee_role_id=role.id, form_id=form.id)
            db.add(rule)
            db.add(models.CampaignEmployeeSelfEvaluation(campaign_id=campaign.id, employee_id=user.id, form_id=form.id))
            db.flush()
            result = update_campaign_evaluation_matrix(campaign.id, payload, db)
            self.assertEqual(result["created_count"], 1)
            issued = db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign.id).one()
            self.assertEqual(issued.form_id, form.id)
            self.assertEqual(build_campaign_evaluation_matrix(campaign.id, db)["groups"][0]["assignments"][0]["form_id"], form.id)

            rule.form_id = replacement.id
            db.flush()
            result = update_campaign_evaluation_matrix(campaign.id, payload, db)
            self.assertEqual(result["created_count"], 0)
            db.refresh(issued)
            self.assertEqual(issued.form_id, form.id)
            self.assertEqual(db.query(models.FilledForm).filter(models.FilledForm.campaign_id == campaign.id).count(), 1)
            with self.assertRaises(HTTPException):
                update_campaign_evaluation_matrix(campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=[]), db)
        finally:
            db.rollback()
            db.close()


if __name__ == '__main__':
    unittest.main()
