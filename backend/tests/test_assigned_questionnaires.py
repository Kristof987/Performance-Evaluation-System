import unittest
from datetime import date, timedelta
from uuid import uuid4

from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from main import get_assigned_questionnaire, update_assigned_questionnaire


class AssignedQuestionnaireTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        role = models.CompanyRole(name=f"Questionnaire role {suffix}")
        system_role = models.SystemRole(name=f"Questionnaire system {suffix}")
        form = models.Form(name=f"Questionnaire {suffix}", questions=[
            {"id": "required", "text": "Feedback", "type": "Text", "required": True},
            {"id": "score", "text": "Score", "type": "Scale 1-5", "required": False},
        ])
        status = models.FormStatus(name=f"Not started {suffix}")
        self.db.add_all([role, system_role, form, status])
        self.db.flush()
        self.users = [models.User(username=f"questionnaire-{index}-{suffix}", email=f"questionnaire-{index}-{suffix}@example.com",
                                  password_hash="test", company_role_id=role.id, system_role_id=system_role.id, is_active=True)
                      for index in range(2)]
        self.db.add_all(self.users)
        self.db.flush()
        self.campaign = models.Campaign(name=f"Questionnaire campaign {suffix}", start_date=date.today(),
                                        end_date=date.today() + timedelta(days=2), created_by=self.users[0].id, is_active=True)
        self.db.add(self.campaign)
        self.db.flush()
        self.filled = models.FilledForm(campaign_id=self.campaign.id, evaluator_id=self.users[0].id,
                                        evaluatee_id=self.users[1].id, form_id=form.id, status_id=status.id, answers=[])
        self.db.add(self.filled)
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def save(self, answers, submit=False):
        return update_assigned_questionnaire(self.users[0].id, self.filled.id,
                                             schemas.AssignedQuestionnaireUpdate(answers=answers, submit=submit), self.db)

    def test_draft_and_submission(self):
        self.save([{"question_id": "score", "value": 4}])
        self.assertEqual(get_assigned_questionnaire(self.users[0].id, self.filled.id, self.db)["answers"],
                         [{"question_id": "score", "value": 4}])
        with self.assertRaises(HTTPException) as error:
            self.save([{"question_id": "score", "value": 4}], submit=True)
        self.assertEqual(error.exception.status_code, 400)
        response = self.save([{"question_id": "required", "value": "Good work"}], submit=True)
        self.assertEqual(response["evaluation"]["finish_date"], date.today())
        with self.assertRaises(HTTPException) as error:
            self.save([{"question_id": "required", "value": "Change"}])
        self.assertEqual(error.exception.status_code, 409)

    def test_rejects_other_user_invalid_answers_and_inactive_campaign(self):
        with self.assertRaises(HTTPException) as error:
            get_assigned_questionnaire(self.users[1].id, self.filled.id, self.db)
        self.assertEqual(error.exception.status_code, 404)
        for answer in ({"question_id": "missing", "value": "x"}, {"question_id": "score", "value": 9}):
            with self.assertRaises(HTTPException) as error:
                self.save([answer])
            self.assertEqual(error.exception.status_code, 400)
        self.campaign.start_date = date.today() + timedelta(days=1)
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            self.save([])
        self.assertEqual(error.exception.status_code, 403)
        self.campaign.start_date = date.today()
        self.campaign.end_date = date.today() - timedelta(days=1)
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            self.save([])
        self.assertEqual(error.exception.status_code, 403)
        self.campaign.end_date = date.today()
        self.campaign.is_active = False
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            self.save([])
        self.assertEqual(error.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
