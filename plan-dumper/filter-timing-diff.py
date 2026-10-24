#!/usr/bin/env python3
"""Filters a unified diff down to hunks that aren't purely runtime-measurement jitter.

Regenerating the example plans re-runs every query, so timing, memory, and scheduler
fields change on every run even when the plan itself didn't. Hunks which only differ on
those volatile fields are dropped. If a hunk differs for any other reason, the whole line is kept as-is.
Files left with no surviving hunks are omitted entirely.

Usage:
    git diff | plan-dumper/filter-timing-diff.py
    plan-dumper/filter-timing-diff.py --revert     # `git checkout --` every file whose
                                                    # diff is purely timing jitter, in place

Any other arguments are forwarded to `git diff`, e.g.:
    plan-dumper/filter-timing-diff.py --cached   # runs `git diff --cached` itself
"""
import argparse
import re
import subprocess
import sys

JSON_SCALAR_RE = r'\s*:\s*(?:"(?:\\.|[^"\\])*"|[-+0-9.eE]+|true|false|null)'

# Volatile fields:
# * Hyper: `cpu-cycles`;
# * Postgres: `Actual Total Time`
# * DuckDB: `cpu_time`, `operator_timing`, and `latency`
# * MariaDB: `r_total_time_ms`/`r_table_time_ms`
COMMON_VOLATILE_FIELD_RE = re.compile(
    r'"(?:[^"]*(?:time|timing|latency|cycles|duration)[^"]*'
    r'|(?:addInput|getOutput|finish|blocked)(?:Cpu|Wall)|start|stop)"'
    + JSON_SCALAR_RE,
    re.IGNORECASE,
)

# DuckDB's `optimizer` object consists entirely of per-pass timing counters.
# These keys do not contain a timing suffix, so the common matcher cannot
# identify them by name. DuckDB also reports allocator-dependent peak/total
# memory counters.
DUCKDB_OPTIMIZER_TIMING_FIELDS = (
    "aggregate_function_rewriter",
    "aggregate_reuse",
    "build_side_probe_side",
    "column_lifetime",
    "common_aggregate",
    "common_subexpressions",
    "common_subplan",
    "cte_filter_pusher",
    "cte_inlining",
    "deliminator",
    "duplicate_groups",
    "empty_result_pullup",
    "expression_rewriter",
    "filter_pullup",
    "filter_pushdown",
    "grouping_sets",
    "in_clause",
    "join_elimination",
    "join_filter_pushdown",
    "join_order",
    "late_materialization",
    "limit_pushdown",
    "outer_join_simplification",
    "partial_aggregate_pushdown",
    "partitioned_execution",
    "projection_placement",
    "projection_pullup",
    "redundant_order_keys",
    "regex_range",
    "reorder_filter",
    "row_group_pruner",
    "row_number_rewriter",
    "sampling_pushdown",
    "scalar_fn_pushdown",
    "statistics_propagation",
    "top_n",
    "top_n_window_elimination",
    "type_pushdown",
    "unnest_rewriter",
    "unused_columns",
    "window_self_join",
)

DUCKDB_PLANNER_TIMING_FIELDS = (
    "column_binding",
    "create_plan",
    "resolve_types",
)

DUCKDB_OPTIMIZER_TIMING_FIELD_RE = re.compile(
    r'"(?:'
    + "|".join(DUCKDB_OPTIMIZER_TIMING_FIELDS + DUCKDB_PLANNER_TIMING_FIELDS)
    + r')"'
    + JSON_SCALAR_RE
)

DUCKDB_VOLATILE_FIELD_RE = re.compile(
    r'"(?:intermediate_size_bytes|peak_buffer_memory|peak_temp_dir_size|'
    r'system_peak_buffer_memory|total_intermediate_size_bytes|total_memory_allocated)"'
    + JSON_SCALAR_RE
)

# Hyper nests additional execution counters in pipeline statistics. Several of
# these keys describe a metric rather than a duration, so they need an
# engine-specific matcher as well.
HYPER_VOLATILE_FIELD_RE = re.compile(
    r'"(?:actual|elapsed|expected|instance-seconds|memory-bytes|memory-mb-seconds|'
    r'peak-transaction-memory-mb|rows-matching-restrictions)"'
    + JSON_SCALAR_RE
)

HYPER_WALL_CLOCK_RE = re.compile(r'"wall-clock"' + JSON_SCALAR_RE)

# Hyper's processed-row counters are nested objects within the per-pipeline
# query metrics. The row counts vary with runtime scheduling and execution
# details, but are not part of the plan structure.
HYPER_PROCESSED_ROWS_RE = re.compile(r'"processed-rows"\s*:\s*\{[^{}]*\}')

# CedarDB does not guarantee the order in which analyzePlanPipelines entries
# are reported. Their operator-ID lists and parallelism labels describe the
# runtime pipeline association, so mask them together with the timing fields
# when comparing CedarDB plans.
CEDARDB_PIPELINE_OPERATORS_RE = re.compile(
    r'(?:"operators"\s*:\s*\[[^\]]*\]|"parallelism"\s*:\s*"[^"]*")'
)

def mask_fields(line, pattern):
    return pattern.sub(lambda match: match.group(0).split(":")[0] + ": ~", line)


def normalize(line, path=None):
    """Masks volatile fields (e.g. `"cpu-cycles": 7949`) so lines that differ only
    in those values compare equal; a line with any other change still differs."""
    line = mask_fields(line, COMMON_VOLATILE_FIELD_RE)
    if path and "/duckdb/" in f"/{path}":
        line = mask_fields(line, DUCKDB_OPTIMIZER_TIMING_FIELD_RE)
        line = mask_fields(line, DUCKDB_VOLATILE_FIELD_RE)
    if path and "/hyper/" in f"/{path}":
        line = mask_fields(line, HYPER_VOLATILE_FIELD_RE)
        line = mask_fields(line, HYPER_WALL_CLOCK_RE)
        line = HYPER_PROCESSED_ROWS_RE.sub(
            lambda match: match.group(0).split(":")[0] + ": ~", line
        )
    if path and "/cedardb/" in f"/{path}":
        line = CEDARDB_PIPELINE_OPERATORS_RE.sub(
            lambda match: match.group(0).split(":")[0] + ": ~", line
        )
    return line


def hunk_is_pure_timing(hunk_lines, path=None):
    removed = [line[1:] for line in hunk_lines if line.startswith("-")]
    added = [line[1:] for line in hunk_lines if line.startswith("+")]
    if not removed or len(removed) != len(added):
        return False
    return all(normalize(r, path) == normalize(a, path) for r, a in zip(removed, added))


FILE_HEADER_RE = re.compile(r"^diff --git a/.+ b/(.+)$")


def parse_file_path(file_header_lines):
    """Extracts the repo-relative path (post-change side) from a `diff --git` header."""
    m = FILE_HEADER_RE.match(file_header_lines[0].rstrip("\n"))
    return m.group(1) if m else None


def filter_diff(text):
    output = []
    file_header = []
    hunks = []
    current_hunk = None
    in_header = True
    dropped_hunks = 0
    dropped_files = []

    def flush_file():
        nonlocal file_header, hunks, current_hunk, dropped_hunks, dropped_files
        if current_hunk is not None:
            hunks.append(current_hunk)
        path = parse_file_path(file_header) if file_header else None
        kept = [h for h in hunks if not hunk_is_pure_timing(h, path)]
        dropped_hunks += len(hunks) - len(kept)
        if kept:
            output.append("".join(file_header))
            output.extend("".join(h) for h in kept)
        elif hunks:
            if path:
                dropped_files.append(path)

    for line in text.splitlines(keepends=True):
        if line.startswith("diff --git "):
            flush_file()
            file_header = [line]
            hunks = []
            current_hunk = None
            in_header = True
        elif line.startswith("@@") and (in_header or current_hunk is not None):
            if current_hunk is not None:
                hunks.append(current_hunk)
            current_hunk = [line]
            in_header = False
        elif in_header:
            file_header.append(line)
        else:
            current_hunk.append(line)

    flush_file()
    return "".join(output), dropped_hunks, dropped_files


def main():
    parser = argparse.ArgumentParser(
        description="Filters a diff down to hunks that aren't purely runtime jitter."
    )
    parser.add_argument("--revert", action="store_true",
                         help="`git checkout --` every file whose diff is purely timing jitter, "
                              "instead of printing the filtered diff.")
    args, git_diff_args = parser.parse_known_args()

    if args.revert or sys.stdin.isatty():
        text = subprocess.run(["git", "diff", *git_diff_args], capture_output=True, text=True, check=True).stdout
    else:
        text = sys.stdin.read()

    filtered, dropped_hunks, dropped_files = filter_diff(text)

    if args.revert:
        if dropped_files:
            subprocess.run(["git", "checkout", "--", *dropped_files], check=True)
        print(f"[filter-timing-diff] reverted {len(dropped_files)} file(s) whose only changes were "
              f"timing jitter ({dropped_hunks} hunk(s)); run `git diff` to review what's left", file=sys.stderr)
        return

    sys.stdout.write(filtered)
    if dropped_hunks:
        print(f"[filter-timing-diff] dropped {dropped_hunks} purely-timing hunk(s), "
              f"{len(dropped_files)} file(s) had no other changes", file=sys.stderr)


if __name__ == "__main__":
    main()
