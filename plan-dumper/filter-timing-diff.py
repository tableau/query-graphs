#!/usr/bin/env python3
"""Filters a unified diff down to hunks that aren't purely runtime-measurement jitter.

Regenerating the example plans re-runs every query, so timing, memory, and scheduler
fields change on every run even when the plan itself didn't. Hunk which only differ on
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
# * Umbra uses `durationUs`;
# * Postgres: `Actual Total Time`
# * DuckDB: `cpu_time`, `operator_timing`, and `latency`
# * Trino: `*Time`, `*Cpu`, and `*Wall` keys
# * MariaDB: `r_total_time_ms`/`r_table_time_ms`
COMMON_VOLATILE_FIELD_RE = re.compile(
    r'"(?:[^"]*(?:time|timing|latency|cycles|duration)[^"]*'
    r'|(?:addInput|getOutput|finish|blocked)(?:Cpu|Wall)|start|stop)"'
    + JSON_SCALAR_RE,
    re.IGNORECASE,
)

# DuckDB also reports allocator-dependent peak/total memory counters.
DUCKDB_VOLATILE_FIELD_RE = re.compile(
    r'"(?:system_peak_buffer_memory|total_memory_allocated)"' + JSON_SCALAR_RE
)

# Trino QueryInfo contains coordinator-generated IDs and scheduler metrics in
# addition to its timing keys. Percentile keys belong to runtime distributions.
TRINO_VOLATILE_FIELD_RE = re.compile(
    r'"(?:queryId|transactionId|stageId|taskId|taskInstanceId|self|version'
    r'|(?:addInput|getOutput|finish)Calls'
    r'|(?:peak|cumulative|outputBufferPeak)[^"]*Memory[^"]*'
    r'|averageBytesPerRequest|successfulRequestsCount|totalPagesSent'
    r'|maxBufferedBytes|digest|min|max|avg|total'
    r'|p(?:01|05|10|25|50|75|90|95|99))"'
    + JSON_SCALAR_RE
)


def mask_fields(line, pattern):
    return pattern.sub(lambda match: match.group(0).split(":")[0] + ": ~", line)


def normalize(line, path=None):
    """Masks volatile fields (e.g. `"cpu-cycles": 7949`) so lines that differ only
    in those values compare equal; a line with any other change still differs."""
    line = mask_fields(line, COMMON_VOLATILE_FIELD_RE)
    if path and "/duckdb/" in f"/{path}":
        line = mask_fields(line, DUCKDB_VOLATILE_FIELD_RE)
    if path and "/trino/" in f"/{path}":
        line = mask_fields(line, TRINO_VOLATILE_FIELD_RE)
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
