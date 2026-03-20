import unittest


class TestPriorityRules(unittest.TestCase):
    def test_statement_like_forced_etransfer_overrides_llm_income(self) -> None:
        # Local import so this test runs without extra packaging steps.
        from api.index import _apply_categorization

        txns = [
            {
                "description": "Interac e-Transfer® Received",
                "amount": 2220.00,
                "category": "Income",
                "confidence_score": 0.95,
            }
        ]
        _apply_categorization(txns)
        self.assertEqual(txns[0]["category"], "E-Transfer")
        self.assertEqual(txns[0]["category_id"], "etransfer")
        self.assertTrue(txns[0]["needs_review"])

    def test_plaid_like_etransfer_overrides_plaid_category(self) -> None:
        from api.index import _apply_categorization

        # Plaid-style transactions may not have confidence_score; still should be overridden.
        txns = [
            {
                "description": "INTERAC E-TRF RECEIVED JOHN DOE",
                "amount": 50.00,
                "category": "INCOME",  # not canonical; should be ignored on override
            }
        ]
        _apply_categorization(txns)
        self.assertEqual(txns[0]["category"], "E-Transfer")
        self.assertEqual(txns[0]["category_id"], "etransfer")


if __name__ == "__main__":
    unittest.main()

