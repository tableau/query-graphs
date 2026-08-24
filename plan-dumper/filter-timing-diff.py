#!/usr/bin/env python3
"""Filters a unified diff down to the hunks that aren't purely runtime-measurement jitter.

Regenerating the example plans re-runs every query, so timing/cycle-count fields (e.g.
Postgres' "Actual Total Time", DuckDB's "cpu_time", Hyper's "cpu-cycles") change on every
run even when the plan itself didn't. A hunk is dropped if every removed line matches its
added counterpart once those volatile fields are masked out; if a line differs for any
other reason, the whole line (including its timing/cycle-count change) is kept as-is.
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

VOLATILE_FIELD_RE = re.compile(
    r'"(?:[^"]*(?:time|timing|latency|cycles|duration)[^"]*'
    r'|(?:addInput|getOutput|finish|blocked)(?:Cpu|Wall)|start|stop)"'
    r'\s*:\s*(?:"(?:\\.|[^"\\])*"|[-+0-9.eE]+)',
    re.IGNORECASE,
)


def normalize(line):
    """Masks volatile fields (e.g. `"cpu-cycles": 7949`) so lines that differ only
    in those values compare equal; a line with any other change still differs."""
    return VOLATILE_FIELD_RE.sub(lambda m: m.group(0).split(":")[0] + ": ~", line)


def hunk_is_pure_timing(hunk_lines):
    removed = [line[1:] for line in hunk_lines if line.startswith("-")]
    added = [line[1:] for line in hunk_lines if line.startswith("+")]
    if not removed or len(removed) != len(added):
        return False
    return all(normalize(r) == normalize(a) for r, a in zip(removed, added))


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
        kept = [h for h in hunks if not hunk_is_pure_timing(h)]
        dropped_hunks += len(hunks) - len(kept)
        if kept:
            output.append("".join(file_header))
            output.extend("".join(h) for h in kept)
        elif hunks:
            path = parse_file_path(file_header)
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
        description="Filters a unified diff down to hunks that aren't purely timing jitter."
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
