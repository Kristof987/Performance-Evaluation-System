import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, ProgrammingError

import main
import schemas

# Permission checks are FastAPI dependencies; calling the endpoint directly supplies the signed-in user.
ACTOR = SimpleNamespace(id=1)


class SectionValidationTests(unittest.TestCase):
    def test_names_normalize_case_and_whitespace(self):
        for name in ("First Section", " first section ", "FIRST SECTION"):
            self.assertEqual(main.normalize_section_name(name)[1], "first section")

    def test_casefold_expansion_is_validated_before_persistence(self):
        with self.assertRaises(HTTPException) as error:
            main.normalize_section_name("\u00df" * 120)
        self.assertEqual(error.exception.status_code, 400)

    def test_only_scoped_name_constraint_is_reported_as_duplicate(self):
        for endpoint in (main.create_section, main.update_section):
            for constraint in ("uq_section_scope_name", "unrelated_constraint"):
                with self.subTest(endpoint=endpoint.__name__, constraint=constraint):
                    db = MagicMock()
                    failure = IntegrityError("statement", {}, SimpleNamespace(diag=SimpleNamespace(constraint_name=constraint)))
                    db.commit.side_effect = failure
                    expected = HTTPException if constraint == "uq_section_scope_name" else IntegrityError
                    with self.assertRaises(expected) as error:
                        if endpoint is main.create_section:
                            endpoint(schemas.SectionCreate(name="Test section"), requester_user_id=1, db=db, actor=ACTOR)
                        else:
                            endpoint(1, schemas.SectionUpdate(name="Test section"), requester_user_id=1, db=db, actor=ACTOR)
                    db.rollback.assert_called_once()
                    if expected is HTTPException:
                        self.assertEqual(error.exception.status_code, 409)
                        self.assertEqual(error.exception.detail, "A section with this name already exists")
                    else:
                        self.assertIs(error.exception, failure)

    def test_missing_table_is_not_reported_as_duplicate(self):
        db = MagicMock()
        failure = ProgrammingError("statement", {}, Exception("relation sections does not exist"))
        db.commit.side_effect = failure
        with self.assertRaises(ProgrammingError) as error:
            main.create_section(schemas.SectionCreate(name="Test section"), requester_user_id=1, db=db, actor=ACTOR)
        self.assertIs(error.exception, failure)


if __name__ == "__main__":
    unittest.main()
