import unittest

from fastapi import HTTPException

from main import validate_matrix_issued_assignments


class MatrixIntegrityTests(unittest.TestCase):
    def test_issued_work_cannot_be_omitted_even_if_unfinished(self):
        issued = {(1, 10, 20): object()}
        with self.assertRaises(HTTPException) as error:
            validate_matrix_issued_assignments(issued, set(issued), set(), set(), {(10, 20, 5)})
        self.assertEqual(error.exception.status_code, 409)

    def test_existing_issued_work_is_preserved_even_if_rule_form_changed(self):
        issued = {(1, 10, 20): object()}
        validate_matrix_issued_assignments(issued, set(issued), set(issued), {(1, 10, 20, 5)}, {(10, 20, 9)})

    def test_other_campaign_or_group_records_are_not_removed(self):
        issued = {(2, 10, 20): object()}
        validate_matrix_issued_assignments(issued, {(1, 10, 20)}, set(), set(), {(10, 20, 5)})

    def test_duplicate_task_in_another_group_is_rejected(self):
        with self.assertRaises(HTTPException) as error:
            validate_matrix_issued_assignments({}, set(), set(), {(2, 10, 20, 5)}, {(10, 20, 5)})
        self.assertEqual(error.exception.status_code, 409)

    def test_duplicate_new_tasks_in_two_groups_are_rejected(self):
        with self.assertRaises(HTTPException):
            validate_matrix_issued_assignments({}, set(), set(), {(1, 10, 20, 5), (2, 10, 20, 5)}, set())

    def test_distinct_tasks_across_groups_are_allowed(self):
        validate_matrix_issued_assignments({}, set(), set(), {(1, 10, 20, 5), (2, 10, 20, 6)}, set())


if __name__ == '__main__':
    unittest.main()
