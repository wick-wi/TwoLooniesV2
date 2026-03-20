import unittest


class TestRunningBalanceValidation(unittest.TestCase):
    def test_chain_aware_walk_advances_when_rb_missing(self) -> None:
        """
        Regression test for a known gap:
        - Model provides running_balance for some rows
        - A middle row has running_balance=None
        - Pass 2 should still advance the expected balance using prev_balance + amount
          so subsequent checkable running_balance comparisons don't fail spuriously.
        """
        from api.index import _validate_signs_from_running_balance

        opening_balance = 75.74
        transactions = [
            {
                "date": "2025-08-29",
                "description": "ATMdeposit - CE730915",
                "amount": 2990.00,
                "running_balance": 3065.74,
            },
            {
                "date": "2025-08-29",
                "description": "BR TO BR - 4508",
                "amount": 40.70,
                "running_balance": None,
            },
            {
                "date": "2025-08-29",
                "description": "to Find& Save",
                "amount": -75.00,
                "running_balance": 3031.44,
            },
        ]

        corrections, validation_ok, mismatch_count, validated_count = _validate_signs_from_running_balance(
            transactions=transactions,
            opening_balance=opening_balance,
            filename="regression-test",
        )

        self.assertTrue(validation_ok)
        self.assertEqual(mismatch_count, 0)
        # Two checkable transactions: ATMdeposit + to Find& Save
        self.assertEqual(validated_count, 2)
        # No sign corrections expected in this synthetic case
        self.assertEqual(corrections, 0)


if __name__ == "__main__":
    unittest.main()

