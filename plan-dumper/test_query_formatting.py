import json
import tempfile
import unittest
from pathlib import Path

from query_formatting import (
    CEDARDB_OPTIMIZER_STEPS,
    explain_queries,
    explain_query,
    generate_example_sql,
    parse_config,
    strip_config_comments,
)


class QueryFormattingTest(unittest.TestCase):
    def test_parses_only_config_comments(self):
        sql = "  --- MODES: simple, ANALYZE\n-- MODES: steps\nSELECT 1"

        self.assertEqual(parse_config(sql, "modes"), ["simple", "analyze"])

    def test_strips_config_comments(self):
        sql = (
            "--- MODES: analyze\n"
            "--- DuckDB does not support this query.\n"
            "-- Keep this comment.\n"
            "--- UNSUPPORTED: duckdb\n"
            "SELECT 1"
        )

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

    def test_formats_engine_and_mode_specific_explain_queries(self):
        cases = {
            ("postgres", "simple"): "EXPLAIN (VERBOSE, FORMAT JSON)",
            ("umbra", "analyze"): "EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON)",
            ("mariadb", "simple"): "EXPLAIN FORMAT=JSON",
            ("mariadb", "analyze"): "ANALYZE FORMAT=JSON",
            ("mariadb", "steps"): "EXPLAIN FORMAT=JSON",
            ("duckdb", "simple"): "EXPLAIN (FORMAT JSON)",
            ("duckdb", "analyze"): "EXPLAIN (ANALYZE, FORMAT JSON)",
            ("duckdb", "steps"): "EXPLAIN (FORMAT JSON)",
            ("hyper", "simple"): "EXPLAIN (FORMAT INTERNAL)",
            ("hyper", "steps"): "EXPLAIN (FORMAT INTERNAL, OPTIMIZE STEPS)",
            ("hyper", "analyze"): "EXPLAIN (FORMAT INTERNAL, ANALYZE)",
            ("hyper", "external-analyze"): "EXPLAIN (FORMAT JSON, ANALYZE, EXPAND_VIEWS true)",
            ("hyper", "analyze-sql"): "EXPLAIN (FORMAT INTERNAL, ANALYZE, EXPRESSIONS SQL)",
        }
        for (engine, mode), prefix in cases.items():
            with self.subTest(engine=engine, mode=mode):
                self.assertEqual(explain_queries(engine, mode, "SELECT 1"), [f"{prefix}\nSELECT 1"])

    def test_formats_every_cedardb_optimizer_step(self):
        queries = explain_queries("cedardb", "steps", "SELECT 1")

        self.assertEqual(len(queries), len(CEDARDB_OPTIMIZER_STEPS))
        self.assertEqual(
            queries[0],
            "EXPLAIN (VERBOSE, FORMAT JSON, STEP NoOptimizations)\nSELECT 1",
        )
        self.assertEqual(
            queries[-1],
            "EXPLAIN (VERBOSE, FORMAT JSON, STEP PhysicalOperatorMapping)\nSELECT 1",
        )

    def test_rejects_unsupported_engine_modes(self):
        self.assertIsNone(explain_queries("postgres", "steps", "SELECT 1"))
        self.assertIsNone(explain_queries("unknown", "analyze", "SELECT 1"))

    def test_generated_duckdb_sql_matches_queries_recorded_in_plans(self):
        repository = Path(__file__).parent.parent
        examples = repository / "standalone-app" / "examples"
        index = json.loads((examples / "index.json").read_text())
        generated = generate_example_sql(index, repository / "plan-dumper" / "queries")

        expected_count = sum(
            len(modes)
            for engine in index["engines"].values()
            for modes in engine["queries"].values()
        )
        self.assertEqual(len(generated), expected_count)
        sql_by_plan = {
            files["plan"]: files["sql"]
            for engine in index["engines"].values()
            for modes in engine["queries"].values()
            for files in modes.values()
        }
        compared = 0
        for plan_path in (examples / "duckdb").glob("**/*-analyze.plan.json"):
            plan = json.loads(plan_path.read_text())
            if isinstance(plan, dict) and isinstance(plan.get("query_name"), str):
                plan_key = plan_path.relative_to(examples).as_posix()
                self.assertEqual(generated[sql_by_plan[plan_key]], plan["query_name"], plan_path)
                compared += 1
        self.assertGreater(compared, 0)

    def test_rejects_duplicate_sql_paths(self):
        index = {
            "engines": {
                "postgres": {
                    "queries": {
                        "query": {
                            "simple": {"plan": "simple.plan.json", "sql": "query.sql"},
                            "analyze": {"plan": "analyze.plan.json", "sql": "query.sql"},
                        }
                    }
                }
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "query.sql").write_text("SELECT 1")
            with self.assertRaisesRegex(ValueError, "duplicate SQL path"):
                generate_example_sql(index, Path(directory))


if __name__ == "__main__":
    unittest.main()
