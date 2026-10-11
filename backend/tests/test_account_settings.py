import unittest
from uuid import uuid4

from fastapi import HTTPException

import models
from database import SessionLocal
from main import get_account_settings_profile


class AccountSettingsTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        self.company_role = models.CompanyRole(name=f"Settings role {suffix}")
        self.system_role = models.SystemRole(name=f"Settings system {suffix}")
        self.group = models.CompanyGroup(name=f"Settings group {suffix}")
        self.db.add_all([self.company_role, self.system_role, self.group])
        self.db.flush()
        self.user = models.User(
            username=f"settings-user-{suffix}",
            email=f"settings-user-{suffix}@example.com",
            password_hash="super-secret-value",
            company_role_id=self.company_role.id,
            system_role_id=self.system_role.id,
            is_active=True,
        )
        self.inactive_user = models.User(
            username=f"settings-inactive-{suffix}",
            email=f"settings-inactive-{suffix}@example.com",
            password_hash="super-secret-value",
            company_role_id=self.company_role.id,
            system_role_id=self.system_role.id,
            is_active=False,
        )
        self.db.add_all([self.user, self.inactive_user])
        self.db.flush()
        self.db.execute(models.user_company_groups.insert().values(user_id=self.user.id, company_group_id=self.group.id))
        self.db.flush()

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_profile_returns_safe_current_account_metadata(self):
        profile = get_account_settings_profile(self.user.id, self.db)
        self.assertEqual(profile["id"], self.user.id)
        self.assertEqual(profile["username"], self.user.username)
        self.assertEqual(profile["email"], self.user.email)
        self.assertEqual(profile["company_role"], self.company_role.name)
        self.assertEqual(profile["system_role"], self.system_role.name)
        self.assertEqual([group["name"] for group in profile["groups"]], [self.group.name])
        self.assertNotIn("password_hash", profile)
        self.assertNotIn("super-secret-value", str(profile))

    def test_profile_handles_no_groups_and_inactive_users(self):
        self.db.execute(models.user_company_groups.delete().where(models.user_company_groups.c.user_id == self.user.id))
        self.db.flush()
        profile = get_account_settings_profile(self.user.id, self.db)
        self.assertEqual(profile["groups"], [])
        with self.assertRaises(HTTPException) as error:
            get_account_settings_profile(self.inactive_user.id, self.db)
        self.assertEqual(error.exception.status_code, 404)


if __name__ == '__main__':
    unittest.main()
