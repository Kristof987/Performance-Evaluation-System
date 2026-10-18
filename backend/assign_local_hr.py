"""Explicit, local-only assignment of the existing Sarah Mitchell test account to HR."""

import argparse
import os

import sqlalchemy as sa
from sqlalchemy.engine import make_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-local-sarah-hr", action="store_true", required=True)
    parser.parse_args()

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("Set DATABASE_URL explicitly to the local development database")
    url = make_url(database_url)
    if (os.getenv("COMPASS_ENV", "").lower() != "development"
            or os.getenv("COMPASS_DEV_LOGIN_ENABLED", "").lower() != "true"
            or url.get_backend_name() != "postgresql"
            or (url.host, url.port) not in {
                ("localhost", 5433), ("127.0.0.1", 5433), ("::1", 5433),
                ("db", 5432),
            }
            or url.database != "performance_evaluation"
            or url.username != "postgres"
            or url.query):
        raise RuntimeError("Sarah's role may only be assigned on the explicitly configured local development database")

    engine = sa.create_engine(url)
    try:
        with engine.begin() as connection:
            account = connection.execute(sa.text("""
                SELECT u.id, u.is_active, u.auth0_user_id, u.system_role_id,
                       sr.name AS system_role_name, e.id AS employee_id,
                       e.full_name, cr.name AS company_role_name
                FROM users AS u
                JOIN system_roles AS sr ON sr.id = u.system_role_id
                JOIN employees AS e ON e.user_id = u.id
                JOIN company_roles AS cr ON cr.id = e.company_role_id
                WHERE u.id = 3
                FOR UPDATE OF u, e
            """)).mappings().one_or_none()
            if (account is None or account["employee_id"] != 1
                    or account["full_name"] != "Sarah Mitchell"
                    or account["company_role_name"] != "HR"
                    or not account["is_active"] or not account["auth0_user_id"]):
                raise RuntimeError("The expected active, linked Sarah Mitchell test account was not found; no role changed")

            if account["system_role_name"] == "HR":
                print("Sarah Mitchell already has the HR system role; no role changed")
                return
            if account["system_role_name"] != "Employee":
                raise RuntimeError("Sarah's current system role is not Employee; no role changed")

            hr_role_id = connection.execute(sa.text(
                "SELECT id FROM system_roles WHERE name = 'HR'"
            )).scalar_one_or_none()
            if hr_role_id is None:
                raise RuntimeError("HR system role is missing; apply the HR role migration first")

            result = connection.execute(sa.text("""
                UPDATE users AS u SET system_role_id = :hr_role_id
                WHERE u.id = 3 AND u.is_active AND u.system_role_id = :employee_role_id
                  AND u.auth0_user_id IS NOT NULL
                  AND EXISTS (
                      SELECT 1 FROM employees AS e
                      JOIN company_roles AS cr ON cr.id = e.company_role_id
                      WHERE e.user_id = u.id AND e.id = 1
                        AND e.full_name = 'Sarah Mitchell' AND cr.name = 'HR'
                  )
            """), {"hr_role_id": hr_role_id, "employee_role_id": account["system_role_id"]})
            if result.rowcount != 1:
                raise RuntimeError("Sarah's account changed during assignment; no role changed")
        print("Assigned the existing Sarah Mitchell test account to the HR system role")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
