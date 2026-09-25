#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from contextlib import closing
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from query_formatting import (
    CEDARDB_OPTIMIZER_STEPS,
    explain_queries,
    generate_example_sql,
    parse_config,
    strip_config_comments,
)


BASE_DIR = Path(__file__).resolve().parent
SETUP_FILE = BASE_DIR / "setup.sql"
QUERIES_DIR = BASE_DIR / "queries"
TARGET_DIR = BASE_DIR.parent / "standalone-app" / "examples"
INDEX_FILE = TARGET_DIR / "index.json"

IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def read_file(path):
    return path.read_text()


# A `--- UNSUPPORTED: duckdb, postgres` comment anywhere in a query file lists the databases
# that can't run it (incompatible syntax, or a semantic difference like division-by-zero
# handling); those databases skip the file instead of erroring out mid-run.
def parse_unsupported(sql):
    return set(parse_config(sql, "unsupported"))


# A `--- MODES: simple, analyze, external-analyze, analyze-sql` comment anywhere in a query file lists the
# EXPLAIN modes to dump it under (one output file per mode); defaults to `analyze` alone
# when absent, since that's what most queries want.
def parse_modes(sql):
    return parse_config(sql, "modes") or ["analyze"]


def run_setup(exec_stmt, setup_file, load_table=None):
    for statement in read_file(setup_file).split(";"):
        statement = statement.strip()
        if statement.startswith("\\include "):
            command = statement.split()
            if len(command) != 2:
                raise ValueError(f"{setup_file}: expected \\include <path>")
            run_setup(exec_stmt, setup_file.parent / command[1], load_table)
        elif statement.startswith("\\copy "):
            if load_table is None:
                raise ValueError(f"{setup_file}: \\copy is not supported")
            command = statement.split()
            if len(command) != 3:
                raise ValueError(f"{setup_file}: expected \\copy <table> <path>")
            load_table(command[1], setup_file.parent / command[2])
        elif statement:
            exec_stmt(statement)


def dump_plans(
    name,
    version,
    get_plan,
):
    queries = {}
    with tempfile.TemporaryDirectory(prefix=f".{name}-", dir=TARGET_DIR) as temporary:
        staging_dir = Path(temporary) / name
        destination = TARGET_DIR / name
        staging_dir.mkdir()

        for query_path in sorted(QUERIES_DIR.glob("**/*.sql")):
            query_file = read_file(query_path).strip()
            unsupported = parse_unsupported(query_file)
            sql = strip_config_comments(query_file).strip()
            relative_path = query_path.relative_to(QUERIES_DIR)

            if name in unsupported:
                print(f"{name}: {query_path.relative_to(BASE_DIR)} (skipped, marked UNSUPPORTED)")
                continue

            modes = []
            for mode in parse_modes(query_file):
                if f"{name}:{mode}" in unsupported:
                    print(
                        f"{name}: {query_path.relative_to(BASE_DIR)} "
                        f"({mode}; skipped, marked UNSUPPORTED)"
                    )
                    continue
                if mode not in modes:
                    modes.append(mode)
            for mode in modes:
                queries_to_explain = explain_queries(name, mode, sql)
                if queries_to_explain is None:
                    print(
                        f"{name}: {query_path.relative_to(BASE_DIR)} "
                        f"({mode}; skipped, unsupported mode)"
                    )
                    continue
                plan = get_plan(queries_to_explain, mode)

                print(f"{name}: {query_path.relative_to(BASE_DIR)} ({mode})")
                suffix = "" if mode == "simple" else f"-{mode}"
                destination_path = staging_dir / relative_path.with_name(
                    relative_path.stem + suffix + ".plan.json"
                )
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                destination_path.write_text(plan)
                query = relative_path.with_suffix("").as_posix()
                plan_url = destination_path.relative_to(staging_dir.parent).as_posix()
                sql_url = plan_url.removesuffix(".plan.json") + ".sql"
                queries.setdefault(query, {})[mode] = {
                    "plan": plan_url,
                    "sql": sql_url,
                }

        if destination.exists():
            shutil.rmtree(destination)
        staging_dir.rename(destination)
    return {
        "version": version,
        "queries": {
            query: dict(sorted(modes.items()))
            for query, modes in sorted(queries.items())
        },
    }


def format_json(value):
    if isinstance(value, str):
        value = json.loads(value)
    return json.dumps(value, indent=2)


def dump_postgres_compatible(name, dsn):
    if not dsn:
        print(f"Skipping {name}: no DSN configured")
        return

    import psycopg2
    from psycopg2 import sql as psycopg2_sql

    def indent_following_lines(value, prefix):
        return value.replace("\n", "\n" + prefix)

    with closing(psycopg2.connect(dsn)) as connection:
        connection.autocommit = True

        def exec_stmt(sql):
            with connection.cursor() as cursor:
                cursor.execute(sql)

        def load_table(table, path):
            if not IDENTIFIER_RE.fullmatch(table):
                raise ValueError(f"invalid table name in \\copy: {table}")
            with connection.cursor() as cursor:
                copy_sql = psycopg2_sql.SQL(
                    "COPY {} FROM STDIN (FORMAT CSV, DELIMITER '|', NULL '\\N')"
                ).format(psycopg2_sql.Identifier(table))
                with path.open() as input_file:
                    cursor.copy_expert(copy_sql.as_string(cursor), input_file)

        def get_plan(queries, mode):
            if mode == "steps":
                plans = []
                with connection.cursor() as cursor:
                    for step, query in zip(CEDARDB_OPTIMIZER_STEPS, queries, strict=True):
                        cursor.execute(query)
                        plan = cursor.fetchone()[0]
                        if not isinstance(plan, str):
                            raise TypeError("CedarDB returned a non-text JSON plan")
                        plan = plan[plan.index("{"):].strip()
                        plans.append(
                            f" {json.dumps(step)}:"
                            + indent_following_lines(plan, " ")
                        )
                return "{\n" + ",\n".join(plans) + "\n}"
            with connection.cursor() as cursor:
                cursor.execute(queries[0])
                plan = cursor.fetchone()[0]
                return plan if isinstance(plan, str) else format_json(plan)

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.postgres.sql",
            load_table,
        )
        connection.commit()
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()[0]
        return dump_plans(name, version, get_plan)


def dump_mariadb(url):
    if not url:
        print("Skipping mariadb: --mariadb-url is not configured")
        return

    import pymysql

    def parse_url():
        parsed = urlparse(url)
        if parsed.scheme not in ("mysql", "mariadb"):
            raise ValueError("expected a mysql:// or mariadb:// URL")
        database = parsed.path.lstrip("/")
        if not IDENTIFIER_RE.fullmatch(database):
            raise ValueError("URL must include a simple database name")
        query = parse_qs(parsed.query)
        options = {
            "host": parsed.hostname or "localhost",
            "port": parsed.port or 3306,
            "user": unquote(parsed.username or ""),
            "password": unquote(parsed.password or ""),
            "database": database,
            "autocommit": True,
            "local_infile": True,
        }
        if "unix_socket" in query:
            options["unix_socket"] = query["unix_socket"][-1]
        return options

    with pymysql.connect(**parse_url()) as connection:
        def exec_stmt(sql):
            with connection.cursor() as cursor:
                cursor.execute(sql)
                if cursor.description:
                    cursor.fetchall()

        def get_plan(queries, mode):
            if mode == "steps":
                with connection.cursor() as cursor:
                    cursor.execute("SET optimizer_trace='enabled=on'")
                    cursor.execute("SET optimizer_trace_max_mem_size=16777216")
                    try:
                        cursor.execute(queries[0])
                        cursor.fetchall()
                        cursor.execute(
                            "SELECT TRACE, MISSING_BYTES_BEYOND_MAX_MEM_SIZE, "
                            "INSUFFICIENT_PRIVILEGES "
                            "FROM INFORMATION_SCHEMA.OPTIMIZER_TRACE"
                        )
                        trace, missing_bytes, insufficient_privileges = cursor.fetchone()
                    finally:
                        cursor.execute("SET optimizer_trace='enabled=off'")
                if insufficient_privileges:
                    raise RuntimeError("insufficient privileges to read MariaDB optimizer trace")
                if missing_bytes:
                    raise RuntimeError(
                        f"MariaDB optimizer trace is missing {missing_bytes} bytes"
                    )
                return trace
            with connection.cursor() as cursor:
                cursor.execute(queries[0])
                return cursor.fetchone()[0]

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.mariadb.sql",
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()[0]
        return dump_plans("mariadb", version, get_plan)


def dump_duckdb():
    import duckdb

    with duckdb.connect() as connection:
        def exec_stmt(sql):
            connection.execute(sql)

        def get_plan(queries, mode):
            if mode == "simple":
                connection.execute("SET explain_output='physical_only'")
            elif mode == "analyze":
                connection.execute("SET explain_output='physical_only'")
            elif mode == "steps":
                connection.execute("SET explain_output='all'")
            records = connection.execute(queries[0]).fetchall()
            if mode == "steps":
                return json.dumps({stage: json.loads(plan) for stage, plan in records}, indent=2)
            return records[0][1]

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.duckdb.sql",
        )
        version = connection.execute("SELECT VERSION()").fetchone()[0]
        return dump_plans("duckdb", version, get_plan)


def dump_hyper(hyper_path):
    from tableauhyperapi import Connection, HyperProcess, Telemetry

    with tempfile.TemporaryDirectory(prefix="query-graphs-hyper-log-") as log_dir:
        with HyperProcess(
            telemetry=Telemetry.SEND_USAGE_DATA_TO_TABLEAU,
            parameters={"log_dir": log_dir},
            hyper_path=hyper_path,
        ) as hyper:
            with Connection(endpoint=hyper.endpoint) as connection:
                def exec_stmt(sql):
                    connection.execute_command(sql)

                def get_plan(queries, _mode):
                    result = connection.execute_list_query(queries[0])
                    return "\n".join(row[0] for row in result)

                run_setup(
                    exec_stmt,
                    SETUP_FILE,
                )
                version = connection.execute_scalar_query("SELECT VERSION()")
                return dump_plans("hyper", version, get_plan)


def main():
    def parse_args():
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--hyper-path",
            type=Path,
            default=None,
            help="Directory containing hyperd; uses the pip-installed Hyper by default.",
        )
        parser.add_argument(
            "--postgres-dsn",
            help="libpq DSN (omitting this option disables Postgres).",
        )
        parser.add_argument(
            "--umbra-dsn",
            help="libpq DSN (omitting this option disables Umbra).",
        )
        parser.add_argument(
            "--cedardb-dsn",
            help="libpq DSN (omitting this option disables CedarDB).",
        )
        parser.add_argument(
            "--mariadb-url",
            help="mysql:// URL (omitting this option disables MariaDB).",
        )
        parser.add_argument(
            "--print-example-sql",
            action="store_true",
            help="Print exact example-plan SQL as JSON for the standalone-app build.",
        )
        return parser.parse_args()

    os.chdir(BASE_DIR)
    args = parse_args()
    if args.print_example_sql:
        index = json.loads(INDEX_FILE.read_text())
        print(json.dumps(generate_example_sql(index, QUERIES_DIR)))
        return 0
    engines = [
        ("postgres", lambda: dump_postgres_compatible("postgres", args.postgres_dsn)),
        ("umbra", lambda: dump_postgres_compatible("umbra", args.umbra_dsn)),
        ("cedardb", lambda: dump_postgres_compatible("cedardb", args.cedardb_dsn)),
        ("mariadb", lambda: dump_mariadb(args.mariadb_url)),
        ("duckdb", dump_duckdb),
        ("hyper", lambda: dump_hyper(args.hyper_path)),
    ]
    engines_index = json.loads(INDEX_FILE.read_text())["engines"]
    failures = []
    for name, dump in engines:
        try:
            engine_index = dump()
            if engine_index is not None:
                engines_index[name] = engine_index
        except Exception as error:
            failures.append((name, error))
            print(f"{name}: failed: {error}", file=sys.stderr)
    index = {"engines": dict(sorted(engines_index.items()))}
    INDEX_FILE.write_text(json.dumps(index, indent=2) + "\n")
    if failures:
        print(
            "Failed engines: " + ", ".join(name for name, _ in failures),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
