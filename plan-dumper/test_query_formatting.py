import unittest

from query_formatting import explain_query, parse_config, strip_config_comments


class QueryFormattingTest(unittest.TestCase):
    def test_parses_only_config_comments(self):
        sql = "  --- MODES: simple, ANALYZE\n-- MODES: steps\nSELECT 1"

        self.assertEqual(parse_config(sql, "modes"), ["simple", "analyze"])

    def test_strips_config_comments(self):
        sql = "--- MODES: analyze\n-- Keep this comment.\n--- UNSUPPORTED: duckdb\nSELECT 1"

        self.assertEqual(strip_config_comments(sql), "-- Keep this comment.\nSELECT 1")

    def test_inserts_explain_after_leading_comments(self):
        sql = "-- First comment.\n-- Second comment.\n\nSELECT 1"

        self.assertEqual(
            explain_query(sql, "EXPLAIN (FORMAT JSON)"),
            "-- First comment.\n-- Second comment.\n\nEXPLAIN (FORMAT JSON)\nSELECT 1",
        )

    def test_inserts_explain_before_uncommented_query(self):
        self.assertEqual(
            explain_query("SELECT 1", "EXPLAIN (FORMAT JSON)"),
            "EXPLAIN (FORMAT JSON)\nSELECT 1",
        )


if __name__ == "__main__":
    unittest.main()
