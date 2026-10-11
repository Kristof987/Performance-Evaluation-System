import unittest

from fastapi import HTTPException

from main import validate_matrix_form_readiness


def pair(evaluator, evaluatee, form_id):
    return {"evaluator_role_id": evaluator, "evaluatee_role_id": evaluatee, "form_id": form_id}


class MatrixReadinessTests(unittest.TestCase):
    def setUp(self):
        self.rules = {
            "forms": [{"id": 11, "name": "Review"}],
            "groups": [
                {"group_id": 1, "group_name": "Engineering", "role_pairs": [pair(3, 3, 11), pair(3, 4, 11), pair(4, 3, 11)]},
                {"group_id": 2, "group_name": "Managers", "role_pairs": [pair(4, 4, 11)]},
            ],
        }

    def test_all_selected_groups_complete(self):
        validate_matrix_form_readiness(self.rules)

    def test_directed_missing_pair_is_reported(self):
        self.rules["groups"][0]["role_pairs"][2]["form_id"] = None
        with self.assertRaises(HTTPException) as error:
            validate_matrix_form_readiness(self.rules)
        self.assertEqual(error.exception.status_code, 409)
        detail = error.exception.detail
        self.assertEqual((detail["required"], detail["configured"], detail["missing"]), (4, 3, 1))
        self.assertEqual(detail["groups"][0]["missing_role_pairs"], [{"evaluator_role_id": 4, "evaluatee_role_id": 3}])

    def test_deleted_form_and_other_group_missing_are_rejected(self):
        self.rules["groups"][1]["role_pairs"][0]["form_id"] = 999
        with self.assertRaises(HTTPException) as error:
            validate_matrix_form_readiness(self.rules)
        self.assertEqual(error.exception.detail["groups"][1]["missing"], 1)

    def test_no_groups_or_no_role_pairs_are_not_ready(self):
        for groups in ([], [{"group_id": 1, "group_name": "Empty", "role_pairs": []}]):
            with self.subTest(groups=groups), self.assertRaises(HTTPException):
                validate_matrix_form_readiness({"forms": [], "groups": groups})


if __name__ == '__main__':
    unittest.main()
