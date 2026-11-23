import unittest
from uuid import uuid4

from fastapi.testclient import TestClient

import models
from database import SessionLocal
from api.dependencies import get_current_user, get_db
from main import app


class AccountSettingsTests(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.commit = self.db.flush
        suffix = uuid4().hex
        self.role = models.SystemRole(name=f"Settings {suffix}")
        self.company_role = models.CompanyRole(name=f"Company {suffix}")
        self.group = models.CompanyGroup(name=f"Group {suffix}")
        self.db.add_all([self.role, self.company_role, self.group])
        self.db.flush()
        self.user = models.User(
            username=f"settings-{suffix}", email=f"{suffix}@example.com",
            password_hash="never-expose-this", system_role_id=self.role.id, is_active=True,
        )
        self.db.add(self.user)
        self.db.flush()
        self.employee = models.Employee(
            full_name="Settings User", user_id=self.user.id,
            company_role_id=self.company_role.id, is_active=True,
        )
        self.db.add(self.employee)
        self.db.flush()
        self.db.execute(models.employee_company_groups.insert().values(
            employee_id=self.employee.id, company_group_id=self.group.id,
        ))
        self.permission = self.db.query(models.SystemPermission).filter_by(name="settings.read").first()
        if self.permission is None:
            self.permission = models.SystemPermission(name="settings.read")
            self.db.add(self.permission)
            self.db.flush()
        self.db.execute(models.system_role_permissions.insert().values(
            system_role_id=self.role.id, permission_id=self.permission.id,
        ))
        self.db.flush()
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()
        self.db.rollback()
        self.db.close()

    def authenticate(self):
        app.dependency_overrides[get_current_user] = lambda: self.user

    def test_unauthenticated_profiles_require_bearer(self):
        for route in ("/me/account-settings/profile", f"/users/{self.user.id}/account-settings/profile"):
            self.assertEqual(self.client.get(route).status_code, 401)

    def test_other_account_is_not_disclosed(self):
        self.authenticate()
        response = self.client.get(f"/users/{self.user.id + 10000}/account-settings/profile")
        self.assertEqual(response.status_code, 404)

    def test_missing_permission_is_forbidden(self):
        self.authenticate()
        self.db.execute(models.system_role_permissions.delete().where(
            models.system_role_permissions.c.system_role_id == self.role.id,
        ))
        self.db.flush()
        self.assertEqual(self.client.get("/me/account-settings/profile").status_code, 403)

    def test_own_profile_is_safe_and_counts_members(self):
        self.authenticate()
        for route in ("/me/account-settings/profile", f"/users/{self.user.id}/account-settings/profile"):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            profile = response.json()
            self.assertEqual(profile["id"], self.user.id)
            self.assertEqual(profile["company_role"], self.company_role.name)
            self.assertEqual(profile["groups"][0]["member_count"], 1)
            self.assertNotIn("password_hash", profile)
            self.assertNotIn("never-expose-this", response.text)

    def test_own_profile_without_employee_is_supported(self):
        self.authenticate()
        self.db.execute(models.employee_company_groups.delete().where(
            models.employee_company_groups.c.employee_id == self.employee.id,
        ))
        self.db.delete(self.employee)
        self.db.flush()
        profile = self.client.get("/me/account-settings/profile").json()
        self.assertEqual(profile["groups"], [])
        self.assertIsNone(profile["company_role"])
