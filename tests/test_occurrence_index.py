import unittest


class TestOccurrenceIndex(unittest.TestCase):
    def test_occurrence_index_resets_per_statement_item(self) -> None:
        """
        Mirrors the API rule:
        - signature_counts must be instantiated inside the per-statement loop
        - signature groups by (date, rounded_amount, normalized_description)
        """
        from api.index import _normalize_date_for_db, _strip_date_prefix_from_description

        def assign_for_item(txns: list[dict]) -> list[int]:
            signature_counts: dict[tuple[str, float, str], int] = {}
            indices: list[int] = []
            for t in txns:
                norm_date = _normalize_date_for_db(t.get("date"))
                self.assertIsNotNone(norm_date)
                norm_date = norm_date  # type: ignore[assignment]

                desc = _strip_date_prefix_from_description(t.get("description"))
                amount_rounded = round(float(t.get("amount", 0) or 0), 2)
                sig = (norm_date, amount_rounded, desc)

                occurrence_index = signature_counts.get(sig, 0) + 1
                signature_counts[sig] = occurrence_index
                indices.append(occurrence_index)
            return indices

        # Same signature appears twice in item 1 => [1, 2]
        item1 = [
            {"date": "2025-03-14", "amount": 10.0, "description": "Starbucks"},
            {"date": "2025-03-14", "amount": 10.00, "description": "Starbucks"},
        ]
        # Same signature appears twice in item 2; indices must reset => [1, 2]
        item2 = [
            {"date": "2025-03-14", "amount": 10.0, "description": "Starbucks"},
            {"date": "2025-03-14", "amount": 10.00, "description": "Starbucks"},
        ]

        self.assertEqual(assign_for_item(item1), [1, 2])
        self.assertEqual(assign_for_item(item2), [1, 2])

    def test_occurrence_index_idempotent_on_reupload(self) -> None:
        """
        Simulates DB uniqueness enforced by (account_id, date, amount, description, occurrence_index)
        and the API using ignore_duplicates=True.
        """
        from api.index import _normalize_date_for_db, _strip_date_prefix_from_description

        account_id = "acc-1"

        def assign_and_keys(txns: list[dict]) -> list[tuple[str, str, float, str, int]]:
            signature_counts: dict[tuple[str, float, str], int] = {}
            keys: list[tuple[str, str, float, str, int]] = []
            for t in txns:
                norm_date = _normalize_date_for_db(t.get("date"))
                self.assertIsNotNone(norm_date)
                norm_date = norm_date  # type: ignore[assignment]
                desc = _strip_date_prefix_from_description(t.get("description"))
                amount_rounded = round(float(t.get("amount", 0) or 0), 2)
                sig = (norm_date, amount_rounded, desc)

                occurrence_index = signature_counts.get(sig, 0) + 1
                signature_counts[sig] = occurrence_index

                keys.append((account_id, norm_date, amount_rounded, desc, occurrence_index))
            return keys

        txns = [
            {"date": "2025-03-14", "amount": 10.00, "description": "Starbucks"},
            {"date": "2025-03-14", "amount": 10.00, "description": "Starbucks"},
        ]

        db_keys: set[tuple[str, str, float, str, int]] = set()

        # First upload inserts two distinct occurrence keys
        keys1 = assign_and_keys(txns)
        for k in keys1:
            db_keys.add(k)
        self.assertEqual(len(db_keys), 2)

        # Second upload attempts to insert same keys; DB ignores duplicates
        keys2 = assign_and_keys(txns)
        for k in keys2:
            db_keys.add(k)
        self.assertEqual(len(db_keys), 2)


if __name__ == "__main__":
    unittest.main()

