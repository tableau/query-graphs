import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("filter-timing-diff.py")
SPEC = importlib.util.spec_from_file_location("filter_timing_diff", MODULE_PATH)
assert SPEC and SPEC.loader
filter_timing_diff = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(filter_timing_diff)


class FilterTimingDiffTest(unittest.TestCase):
    def test_duckdb_optimizer_planner_and_memory_counters_are_volatile(self):
        diff = """\
diff --git a/standalone-app/examples/duckdb/example.plan.json b/standalone-app/examples/duckdb/example.plan.json
index 1111111..2222222 100644
--- a/standalone-app/examples/duckdb/example.plan.json
+++ b/standalone-app/examples/duckdb/example.plan.json
@@ -1,8 +1,8 @@
-        \"aggregate_function_rewriter\": 0.1,
+        \"aggregate_function_rewriter\": 0.2,
-        \"column_binding\": 0.3,
+        \"column_binding\": 0.4,
-        \"peak_buffer_memory\": 100,
+        \"peak_buffer_memory\": 200,
"""

        filtered, dropped_hunks, dropped_files = filter_timing_diff.filter_diff(diff)

        self.assertEqual(filtered, "")
        self.assertEqual(dropped_hunks, 1)
        self.assertEqual(dropped_files, ["standalone-app/examples/duckdb/example.plan.json"])

    def test_duckdb_intermediate_sizes_are_volatile(self):
        diff = """\
diff --git a/standalone-app/examples/duckdb/example.plan.json b/standalone-app/examples/duckdb/example.plan.json
index 1111111..2222222 100644
--- a/standalone-app/examples/duckdb/example.plan.json
+++ b/standalone-app/examples/duckdb/example.plan.json
@@ -1,2 +1,2 @@
-        \"intermediate_size_bytes\": 16600,
+        \"intermediate_size_bytes\": 32984,
-        \"total_intermediate_size_bytes\": 189108,
+        \"total_intermediate_size_bytes\": 238260,
"""

        filtered, dropped_hunks, dropped_files = filter_timing_diff.filter_diff(diff)

        self.assertEqual(filtered, "")
        self.assertEqual(dropped_hunks, 1)
        self.assertEqual(dropped_files, ["standalone-app/examples/duckdb/example.plan.json"])

    def test_hyper_pipeline_metrics_are_volatile(self):
        diff = """\
diff --git a/standalone-app/examples/hyper/example.plan.json b/standalone-app/examples/hyper/example.plan.json
index 1111111..2222222 100644
--- a/standalone-app/examples/hyper/example.plan.json
+++ b/standalone-app/examples/hyper/example.plan.json
@@ -1,2 +1,2 @@
-{"statistics":{"cpu-cycles":100,"query-metrics":{"elapsed":1e-5,"wall-clock":2e-5,"memory-mb-seconds":2e-5,"instance-seconds":1e-5,"threads":{"thread-time":1e-5},"peak-transaction-memory-mb":0.5},"memory-bytes":1024}}
+{"statistics":{"cpu-cycles":200,"query-metrics":{"elapsed":2e-5,"wall-clock":3e-5,"memory-mb-seconds":4e-5,"instance-seconds":2e-5,"threads":{"thread-time":2e-5},"peak-transaction-memory-mb":0.6},"memory-bytes":2048}}
"""

        filtered, dropped_hunks, dropped_files = filter_timing_diff.filter_diff(diff)

        self.assertEqual(filtered, "")
        self.assertEqual(dropped_hunks, 1)
        self.assertEqual(dropped_files, ["standalone-app/examples/hyper/example.plan.json"])

    def test_hyper_nested_runtime_counters_are_volatile(self):
        diff = """\
diff --git a/standalone-app/examples/hyper/example.plan.json b/standalone-app/examples/hyper/example.plan.json
index 1111111..2222222 100644
--- a/standalone-app/examples/hyper/example.plan.json
+++ b/standalone-app/examples/hyper/example.plan.json
@@ -1,2 +1,2 @@
-{\"statistics\":{\"query-metrics\":{\"processed-rows\":{\"total\":572,\"native\":572},\"additional-entries\":{\"scan-stats\":{\"rows-matching-restrictions\":42}}}}}
+{\"statistics\":{\"query-metrics\":{\"processed-rows\":{\"total\":533,\"native\":533},\"additional-entries\":{\"scan-stats\":{\"rows-matching-restrictions\":3}}}}}
"""

        filtered, dropped_hunks, dropped_files = filter_timing_diff.filter_diff(diff)

        self.assertEqual(filtered, "")
        self.assertEqual(dropped_hunks, 1)
        self.assertEqual(dropped_files, ["standalone-app/examples/hyper/example.plan.json"])


if __name__ == "__main__":
    unittest.main()
