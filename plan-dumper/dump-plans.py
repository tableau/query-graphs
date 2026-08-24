#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import shutil
import sys
import tempfile
import uuid
from contextlib import closing
from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

import duckdb
import psycopg2
import pymysql
import trino
from psycopg2 import sql as psycopg2_sql
from tableauhyperapi import Connection, HyperProcess, Telemetry


BASE_DIR = Path(__file__).resolve().parent
SETUP_FILE = BASE_DIR / "setup.sql"
QUERIES_DIR = BASE_DIR / "queries"
TARGET_DIR = BASE_DIR.parent / "standalone-app" / "examples"

IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def read_file(path):
    return path.read_text()


unsupported_re = re.compile(
    r"^--\s*UNSUPPORTED:\s*(.+)$",
    re.MULTILINE | re.IGNORECASE,
)
def parse_unsupported(sql):
    match = unsupported_re.search(sql)
    if not match:
        return set()
    return {db.strip().lower() for db in match.group(1).split(",")}


modes_re = re.compile(r"^--\s*MODES:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
def parse_modes(sql):
    match = modes_re.search(sql)
    if not match:
        return ["analyze"]
    return [mode.strip().lower() for mode in match.group(1).split(",")]


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
    get_plan,
):
    with tempfile.TemporaryDirectory(prefix=f".{name}-", dir=TARGET_DIR) as temporary:
        staging_dir = Path(temporary) / name
        destination = TARGET_DIR / name
        staging_dir.mkdir()

        for query_path in sorted(QUERIES_DIR.glob("**/*.sql")):
            sql = read_file(query_path).strip()
            unsupported = parse_unsupported(sql)
            relative_path = query_path.relative_to(QUERIES_DIR)

            if name in unsupported:
                print(f"{name}: {query_path.relative_to(BASE_DIR)} (skipped, marked UNSUPPORTED)")
                continue

            modes = []
            for mode in parse_modes(sql):
                if f"{name}:{mode}" in unsupported:
                    print(
                        f"{name}: {query_path.relative_to(BASE_DIR)} "
                        f"({mode}; skipped, marked UNSUPPORTED)"
                    )
                    continue
                if mode not in modes:
                    modes.append(mode)
            for mode in modes:
                plan = get_plan(sql, mode)
                if plan is None:
                    print(
                        f"{name}: {query_path.relative_to(BASE_DIR)} "
                        f"({mode}; skipped, unsupported mode)"
                    )
                    continue

                print(f"{name}: {query_path.relative_to(BASE_DIR)} ({mode})")
                suffix = "" if mode == "simple" else f"-{mode}"
                destination_path = staging_dir / relative_path.with_name(
                    relative_path.stem + suffix + ".plan.json"
                )
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                destination_path.write_text(plan)

        if destination.exists():
            shutil.rmtree(destination)
        staging_dir.rename(destination)


def format_json(value):
    if isinstance(value, str):
        value = json.loads(value)
    return json.dumps(value, indent=2)


def dump_postgres_compatible(name, dsn):
    if not dsn:
        print(f"Skipping {name}: no DSN configured")
        return

    def decode_umbra_step_plan(value):
        if not value:
            return "null"
        output = []
        in_string = False
        escaped = False
        offset = 0
        while offset < len(value):
            character = value[offset]
            if in_string:
                output.append(character)
                if escaped:
                    escaped = False
                elif character == "\\":
                    escaped = True
                elif character == '"':
                    in_string = False
            elif character == '"':
                in_string = True
                output.append(character)
            elif character == "\\" and value[offset:offset + 2] == "\\n":
                output.append("\n")
                offset += 1
            else:
                output.append(character)
            offset += 1
        return "".join(output)

    def indent_following_lines(value, prefix):
        return value.replace("\n", "\n" + prefix)

    with closing(psycopg2.connect(dsn)) as connection:
        connection.autocommit = True
        umbra_steps_supported = False
        if name == "umbra":
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT EXISTS (SELECT 1 FROM pg_settings "
                    "WHERE name = 'debug.optimizer.steplog')"
                )
                umbra_steps_supported = cursor.fetchone()[0]

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

        def get_plan(sql, mode):
            if mode == "simple":
                explain = "EXPLAIN (VERBOSE, FORMAT JSON) "
            elif mode == "analyze":
                explain = "EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON) "
            elif mode == "steps" and name == "cedardb":
                optimizer_steps = (
                    "NoOptimizations",
                    "ExpressionSimplification",
                    "Unnesting",
                    "PredicatePushdown",
                    "InitialJoinTree",
                    "SidewayInformationPassing",
                    "OperatorReordering",
                    "EarlyProbing",
                    "CommonSubtreeElimination",
                    "PhysicalOperatorMapping",
                )
                plans = []
                with connection.cursor() as cursor:
                    for step in optimizer_steps:
                        cursor.execute(
                            f"EXPLAIN (VERBOSE, FORMAT JSON, STEP {step}) " + sql
                        )
                        plan = cursor.fetchone()[0]
                        if not isinstance(plan, str):
                            raise TypeError("CedarDB returned a non-text JSON plan")
                        plan = plan[plan.index("{"):].strip()
                        plans.append(
                            f" {json.dumps(step)}:"
                            + indent_following_lines(plan, " ")
                        )
                return "{\n" + ",\n".join(plans) + "\n}"
            elif mode == "steps" and name == "umbra" and umbra_steps_supported:
                log_path = f"/tmp/query-graphs-{uuid.uuid4().hex}.csv"
                with connection.cursor() as cursor:
                    cursor.execute(
                        "CREATE TEMP TABLE IF NOT EXISTS umbra_optimizer_steps ("
                        "query_id bigint, event_id bigint, depth integer, step text, "
                        "source_location text, changed boolean, duration_us bigint, "
                        "plan_json text)"
                    )
                    cursor.execute("TRUNCATE umbra_optimizer_steps")
                    cursor.execute(f"SET debug.optimizer.steplog = '{log_path}'")
                    try:
                        cursor.execute("EXPLAIN (VERBOSE, FORMAT JSON) " + sql)
                        cursor.fetchall()
                    finally:
                        cursor.execute("SET debug.optimizer.steplog = off")
                    cursor.execute(
                        f"COPY umbra_optimizer_steps FROM '{log_path}' "
                        "(FORMAT CSV, HEADER TRUE)"
                    )
                    cursor.execute(
                        "SELECT query_id, event_id, depth, step, source_location, "
                        "changed, duration_us, plan_json "
                        "FROM umbra_optimizer_steps ORDER BY event_id"
                    )
                    events = []
                    for (
                        query_id,
                        event_id,
                        depth,
                        step,
                        source_location,
                        changed,
                        duration_us,
                        plan_json,
                    ) in cursor.fetchall():
                        plan = decode_umbra_step_plan(plan_json)
                        event = (
                            "{\n"
                            f' "queryId":{json.dumps(query_id)},\n'
                            f' "eventId":{json.dumps(event_id)},\n'
                            f' "depth":{json.dumps(depth)},\n'
                            f' "step":{json.dumps(step)},\n'
                            f' "sourceLocation":{json.dumps(source_location)},\n'
                            f' "changed":{json.dumps(changed)},\n'
                            f' "durationUs":{json.dumps(duration_us)},\n'
                            f' "plan":{indent_following_lines(plan, " ")}\n'
                            "}"
                        )
                        events.append(" " + indent_following_lines(event, " "))
                return "[\n" + ",\n".join(events) + "\n]"
            else:
                return None
            with connection.cursor() as cursor:
                cursor.execute(explain + sql)
                plan = cursor.fetchone()[0]
                return plan if isinstance(plan, str) else format_json(plan)

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.postgres.sql",
            load_table,
        )
        connection.commit()
        dump_plans(name, get_plan)


def dump_mariadb(url):
    if not url:
        print("Skipping mariadb: --mariadb-url is not configured")
        return

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

        def get_plan(sql, mode):
            if mode == "simple":
                explain = "EXPLAIN FORMAT=JSON "
            elif mode == "analyze":
                explain = "ANALYZE FORMAT=JSON "
            elif mode == "steps":
                with connection.cursor() as cursor:
                    cursor.execute("SET optimizer_trace='enabled=on'")
                    cursor.execute("SET optimizer_trace_max_mem_size=16777216")
                    try:
                        cursor.execute("EXPLAIN FORMAT=JSON " + sql)
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
            else:
                return None
            with connection.cursor() as cursor:
                cursor.execute(explain + sql)
                return cursor.fetchone()[0]

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.mariadb.sql",
        )
        dump_plans("mariadb", get_plan)


def dump_trino(url):
    if not url:
        print("Skipping trino: --trino-url is not configured")
        return

    def parse_url():
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise ValueError("expected an http:// or https:// URL")
        if parsed.password is not None:
            raise ValueError("password-authenticated Trino is not supported")
        path = [unquote(part) for part in parsed.path.split("/") if part]
        if len(path) != 2 or not all(IDENTIFIER_RE.fullmatch(part) for part in path):
            raise ValueError("URL path must be /catalog/schema using simple identifiers")
        if path[1] != "query_graphs_plan_dumper":
            raise ValueError(
                "Trino schema must be the dedicated query_graphs_plan_dumper scratch schema"
            )
        host = parsed.hostname or "localhost"
        port = parsed.port or (443 if parsed.scheme == "https" else 8080)
        url_host = f"[{host}]" if ":" in host else host
        coordinator_url = f"{parsed.scheme}://{url_host}:{port}"
        return {
            "host": host,
            "port": port,
            "user": unquote(parsed.username or "plan-dumper"),
            "http_scheme": parsed.scheme,
        }, path, coordinator_url

    options, (catalog, schema), coordinator_url = parse_url()
    with trino.dbapi.connect(catalog=catalog, **options) as connection:
        cursor = connection.cursor()
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
        cursor.fetchall()
        cursor.execute(f"USE {catalog}.{schema}")
        cursor.fetchall()

        def read_rows(path):
            with path.open(newline="") as input_file:
                yield from csv.reader(input_file, delimiter="|", quotechar='"')

        def exec_stmt(sql):
            cursor.execute(sql)
            cursor.fetchall()

        def load_table(table, path):
            cursor.execute(f"DESCRIBE {table}")
            column_types = [row[1].lower() for row in cursor.fetchall()]

            def to_sql(value, sql_type):
                if sql_type in ("integer", "bigint", "smallint", "tinyint"):
                    return str(int(value))
                if sql_type.startswith("decimal"):
                    return str(Decimal(value))
                if sql_type == "date":
                    return f"DATE '{date.fromisoformat(value).isoformat()}'"
                return "'" + value.replace("'", "''") + "'"

            rows = [
                "(" + ", ".join(
                    to_sql(value, sql_type) for value, sql_type in zip(row, column_types)
                ) + ")"
                for row in read_rows(path)
            ]
            for offset in range(0, len(rows), 100):
                cursor.execute(f"INSERT INTO {table} VALUES " + ", ".join(rows[offset:offset + 100]))
                cursor.fetchall()

        def get_plan(sql, mode):
            query = sql.rstrip().removesuffix(";")
            if mode == "simple":
                cursor.execute("EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON) " + query)
                return cursor.fetchone()[0]
            if mode == "analyze":
                cursor.execute(query)
                cursor.fetchall()
                query_id = cursor.stats.get("queryId")
                if not query_id:
                    raise RuntimeError("Trino client did not report the executed query ID")
                request = Request(
                    f"{coordinator_url}/v1/query/{quote(query_id, safe='')}",
                    headers={"X-Trino-User": options["user"]},
                )
                with urlopen(request, timeout=30) as response:
                    return format_json(json.load(response))
            return None

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.trino.sql",
            load_table,
        )
        dump_plans("trino", get_plan)


def dump_duckdb():
    with duckdb.connect() as connection:
        def exec_stmt(sql):
            connection.execute(sql)

        def get_plan(sql, mode):
            if mode == "simple":
                connection.execute("SET explain_output='physical_only'")
                explain = "EXPLAIN (FORMAT JSON) "
            elif mode == "analyze":
                connection.execute("SET explain_output='physical_only'")
                explain = "EXPLAIN (ANALYZE, FORMAT JSON) "
            elif mode == "steps":
                connection.execute("SET explain_output='all'")
                explain = "EXPLAIN (FORMAT JSON) "
            else:
                return None
            records = connection.execute(explain + sql).fetchall()
            if mode == "steps":
                return json.dumps({stage: json.loads(plan) for stage, plan in records}, indent=2)
            return records[0][1]

        run_setup(
            exec_stmt,
            BASE_DIR / "setup.duckdb.sql",
        )
        dump_plans("duckdb", get_plan)


def dump_hyper(hyper_path):
    parameters = {"log_config": ""}
    with HyperProcess(
        telemetry=Telemetry.SEND_USAGE_DATA_TO_TABLEAU,
        parameters=parameters,
        hyper_path=hyper_path,
    ) as hyper:
        with Connection(endpoint=hyper.endpoint) as connection:
            def exec_stmt(sql):
                connection.execute_command(sql)

            def get_plan(sql, mode):
                options = {
                    "simple": "FORMAT INTERNAL",
                    "steps": "FORMAT INTERNAL, OPTIMIZE STEPS",
                    "analyze": "FORMAT INTERNAL, ANALYZE",
                    "pipelines": (
                        "FORMAT INTERNAL, PIPELINES, EXPAND_VIEWS true, EXPRESSIONS SQL"
                    ),
                    "analyze-pipelines": (
                        "FORMAT INTERNAL, PIPELINES, ANALYZE, "
                        "EXPAND_VIEWS true, EXPRESSIONS SQL"
                    ),
                }
                if mode not in options:
                    return None
                result = connection.execute_list_query(
                    f"EXPLAIN ({options[mode]}) " + sql
                )
                return "\n".join(row[0] for row in result)

            run_setup(
                exec_stmt,
                SETUP_FILE,
            )
            dump_plans("hyper", get_plan)


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
            "--trino-url",
            help=(
                "http(s)://user@host:port/catalog/schema "
                "(omitting this option disables Trino)."
            ),
        )
        return parser.parse_args()

    os.chdir(BASE_DIR)
    args = parse_args()
    engines = [
        ("postgres", lambda: dump_postgres_compatible("postgres", args.postgres_dsn)),
        ("umbra", lambda: dump_postgres_compatible("umbra", args.umbra_dsn)),
        ("cedardb", lambda: dump_postgres_compatible("cedardb", args.cedardb_dsn)),
        ("mariadb", lambda: dump_mariadb(args.mariadb_url)),
        ("trino", lambda: dump_trino(args.trino_url)),
        ("duckdb", dump_duckdb),
        ("hyper", lambda: dump_hyper(args.hyper_path)),
    ]
    failures = []
    for name, dump in engines:
        try:
            dump()
        except Exception as error:
            failures.append((name, error))
            print(f"{name}: failed: {error}", file=sys.stderr)
    if failures:
        print(
            "Failed engines: " + ", ".join(name for name, _ in failures),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
