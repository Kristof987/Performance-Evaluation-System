import unittest
from datetime import date
from uuid import uuid4

from fastapi import HTTPException

import models
import schemas
from database import SessionLocal
from api.campaign_setup import get_campaign_self_evaluations, update_campaign_self_evaluations, update_campaign_evaluation_matrix
from services.campaign_service import issue_activation_snapshots
from services.campaign_service import validate_campaign_configuration


class CampaignSelfEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        role = models.CompanyRole(name=f"Self role {suffix}")
        system_role = models.SystemRole(name=f"Self system {suffix}")
        self.groups = [models.CompanyGroup(name=f"Self group {index} {suffix}") for index in range(2)]
        self.forms = [models.Form(name=f"Self form {index} {suffix}", questions=[{"type": "question", "question": {"id": "q", "text": "How did it go?", "type": "Text", "required": True}}]) for index in range(2)]
        self.db.add_all([role, system_role, *self.groups, *self.forms])
        self.db.flush()
        accounts = [
            models.User(username=f"self-{index}-{suffix}", email=f"self-{index}-{suffix}@example.com",
                        password_hash="", system_role_id=system_role.id, is_active=True)
            for index in range(3)
        ]
        self.db.add_all(accounts)
        self.db.flush()
        self.actor = accounts[2]
        # "users" are the evaluated employees; the account row only provides a sign-in.
        self.users = [models.Employee(user_id=account.id, full_name=f"Self person {index} {suffix}",
                                      company_role_id=role.id, is_active=True)
                      for index, account in enumerate(accounts[:2])]
        self.db.add_all(self.users)
        self.db.flush()
        self.role = role
        self.campaign = models.Campaign(name=f"Self campaign {suffix}", start_date=date.today(), created_by=self.actor.id)
        self.db.add(self.campaign)
        self.db.flush()
        for group in self.groups:
            self.db.execute(models.campaign_company_groups.insert().values(campaign_id=self.campaign.id, company_group_id=group.id))
            for user in self.users:
                self.db.execute(models.employee_company_groups.insert().values(employee_id=user.id, company_group_id=group.id))
            self.db.add(models.CampaignEvaluationRule(
                campaign_id=self.campaign.id, company_group_id=group.id,
                evaluator_role_id=role.id, evaluatee_role_id=role.id, form_id=self.forms[1].id,
            ))
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def assignment(self, group, evaluator, evaluatee):
        return schemas.CampaignEvaluationMatrixUpdateItem(
            company_group_id=group.id, evaluator_id=evaluator.id, evaluatee_id=evaluatee.id,
        )

    def save_mapping(self, assignments):
        return update_campaign_self_evaluations(
            self.campaign.id, schemas.CampaignSelfEvaluationsUpdate(assignments=[
                schemas.CampaignSelfEvaluationAssignment(employee_id=user.id, form_id=form_id)
                for user, form_id in assignments
            ]), self.db, manager=self.actor,
        )

    def test_participants_are_deduplicated_and_mapping_is_canonical(self):
        response = get_campaign_self_evaluations(self.campaign.id, self.db, _reader=self.actor)
        self.assertEqual(len(response["participants"]), 2)
        self.assertTrue(all(len(row["group_names"]) == 2 for row in response["participants"]))
        self.save_mapping([(self.users[0], self.forms[0].id)])
        response = get_campaign_self_evaluations(self.campaign.id, self.db, _reader=self.actor)
        self.assertEqual({row["employee_id"]: row["form_id"] for row in response["participants"]},
                         {self.users[0].id: self.forms[0].id, self.users[1].id: None})
        self.assertEqual(self.db.query(models.CampaignEmployeeSelfEvaluation).filter_by(campaign_id=self.campaign.id).count(), 1)

    def test_invalid_assignments_leave_existing_mapping_unchanged(self):
        self.save_mapping([(self.users[0], self.forms[0].id)])
        for assignments in (
            [(self.users[0], self.forms[1].id), (self.users[0], self.forms[0].id)],
            [(self.users[0], 99999999)],
        ):
            with self.assertRaises(HTTPException) as error:
                self.save_mapping(assignments)
            self.assertEqual(error.exception.status_code, 400)
        mapping = self.db.query(models.CampaignEmployeeSelfEvaluation).filter_by(
            campaign_id=self.campaign.id, employee_id=self.users[0].id,
        ).one()
        self.assertEqual(mapping.form_id, self.forms[0].id)

    def test_unknown_campaign_and_out_of_scope_employee_are_rejected(self):
        with self.assertRaises(HTTPException) as error:
            get_campaign_self_evaluations(99999999, self.db, _reader=self.actor)
        self.assertEqual(error.exception.status_code, 404)
        with self.assertRaises(HTTPException) as error:
            update_campaign_self_evaluations(
                99999999, schemas.CampaignSelfEvaluationsUpdate(assignments=[]), self.db, manager=self.actor,
            )
        self.assertEqual(error.exception.status_code, 404)
        stranger = models.Employee(full_name=f"Stranger {uuid4().hex}", company_role_id=self.role.id, is_active=True)
        self.db.add(stranger)
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            self.save_mapping([(stranger, self.forms[0].id)])
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(self.db.query(models.CampaignEmployeeSelfEvaluation).filter_by(
            campaign_id=self.campaign.id,
        ).count(), 0)

    def test_individual_forms_and_no_form_preserve_other_campaigns(self):
        other = models.Campaign(
            name=f"Other self campaign {uuid4().hex}", start_date=date.today(), created_by=self.actor.id,
        )
        self.db.add(other)
        self.db.flush()
        self.db.add(models.CampaignEmployeeSelfEvaluation(
            campaign_id=other.id, employee_id=self.users[0].id, form_id=self.forms[1].id,
        ))
        self.save_mapping([(self.users[0], self.forms[0].id), (self.users[1], self.forms[1].id)])
        self.save_mapping([(self.users[0], None), (self.users[1], self.forms[1].id)])
        response = get_campaign_self_evaluations(self.campaign.id, self.db, _reader=self.actor)
        self.assertEqual({row["employee_id"]: row["form_id"] for row in response["participants"]}, {
            self.users[0].id: None, self.users[1].id: self.forms[1].id,
        })
        self.assertEqual(self.db.query(models.CampaignEmployeeSelfEvaluation).filter_by(
            campaign_id=other.id, employee_id=self.users[0].id,
        ).one().form_id, self.forms[1].id)

    def test_matrix_uses_dedicated_self_form_once_across_groups_and_ordinary_rule(self):
        self.save_mapping([(self.users[0], self.forms[0].id)])
        requested = [self.assignment(group, self.users[0], self.users[0]) for group in self.groups]
        requested.append(self.assignment(self.groups[0], self.users[0], self.users[1]))
        result = update_campaign_evaluation_matrix(
            self.campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=requested), self.db, manager=self.actor,
        )
        self.assertEqual(result["created_count"], 2)
        records = self.db.query(models.FilledForm).filter_by(campaign_id=self.campaign.id).all()
        self.assertEqual(len(records), 2)
        self.assertEqual({(record.evaluatee_id, record.form_id) for record in records}, {
            (self.users[0].id, self.forms[0].id), (self.users[1].id, self.forms[1].id),
        })
        self.assertEqual(update_campaign_evaluation_matrix(
            self.campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=requested), self.db, manager=self.actor,
        )["created_count"], 0)
        # Planned pairs follow the mapping; once issued, the self-evaluation is locked.
        self.assertEqual(issue_activation_snapshots(self.campaign, self.db), [])
        self.db.flush()
        with self.assertRaises(HTTPException) as error:
            self.save_mapping([(self.users[0], self.forms[1].id)])
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException) as error:
            self.save_mapping([])
        self.assertEqual(error.exception.status_code, 409)
        self.assertTrue(next(row for row in get_campaign_self_evaluations(self.campaign.id, self.db, _reader=self.actor)["participants"]
                             if row["employee_id"] == self.users[0].id)["locked"])

    def test_self_pair_without_form_is_planned_but_blocks_scheduling(self):
        # The matrix may be planned before questionnaires are chosen; scheduling then names what is missing.
        result = update_campaign_evaluation_matrix(self.campaign.id, schemas.CampaignEvaluationMatrixUpdate(assignments=[
            self.assignment(self.groups[0], self.users[0], self.users[0]),
        ]), self.db, manager=self.actor)
        self.assertEqual(result["created_count"], 1)
        record = self.db.query(models.FilledForm).filter_by(campaign_id=self.campaign.id).one()
        self.assertIsNone(record.form_id)
        self.assertIsNone(record.form_snapshot)
        errors = validate_campaign_configuration(self.campaign, self.db)
        self.assertTrue(any("needs a questionnaire selected on the Self-evaluations tab" in error for error in errors))

if __name__ == "__main__":
    unittest.main()
