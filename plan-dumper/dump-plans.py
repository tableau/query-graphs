#!/usr/bin/env python3
import argparse
import csv
import json
import re
import shutil
import sys
import tempfile
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen

import duckdb
import psycopg2
import pymysql
import trino
from tableauhyperapi import Connection, HyperProcess, Telemetry


BASE_DIR = Path(__file__).resolve().parent
SETUP_FILE = BASE_DIR / "setup.sql"
QUERIES_DIR = BASE_DIR / "queries"
TARGET_DIR = BASE_DIR.parent / "standalone-app" / "examples"

UNSUPPORTED_RE = re.compile(r"^--\s*UNSUPPORTED:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
MODES_RE = re.compile(r"^--\s*MODES:\s*(.+)$", re.MULTILINE | re.IGNORECASE)
DATA_FILES = (
    ("customer", "customer.tbl"),
    ("lineitem", "lineitem.tbl"),
    ("nation", "nation.tbl"),
    ("orders", "orders.tbl"),
    ("partsupp", "partsupp.tbl"),
    ("part", "part.tbl"),
    ("region", "region.tbl"),
    ("supplier", "supplier.tbl"),
)
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


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


def read_file(path):
    return path.read_text()


def parse_unsupported(sql):
    match = UNSUPPORTED_RE.search(sql)
    if not match:
        return set()
    return {db.strip().lower() for db in match.group(1).split(",")}


def parse_modes(sql):
    match = MODES_RE.search(sql)
    if not match:
        return ["analyze"]
    return [mode.strip().lower() for mode in match.group(1).split(",")]


def read_rows(path):
    with path.open(newline="") as input_file:
        yield from csv.reader(input_file, delimiter="|", quotechar='"')


def load_tables(load_table):
    for table, filename in DATA_FILES:
        load_table(table, BASE_DIR / "tpch-data-tiny" / filename)


def run_setup(exec_stmt, setup_file=SETUP_FILE):
    for statement in read_file(setup_file).split(";"):
        if statement.strip():
            exec_stmt(statement)


def format_json(value):
    if isinstance(value, str):
        value = json.loads(value)
    return json.dumps(value, indent=2)


def parse_umbra_step_plan(value):
    if not value:
        return None
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
    return json.loads("".join(output))


def dump_plans(
    name,
    setup,
    get_plan,
    recover_after_error=lambda: None,
):
    setup()
    failures = []
    with tempfile.TemporaryDirectory(prefix=f".{name}-", dir=TARGET_DIR) as temporary:
        staging_dir = Path(temporary) / name
        destination = TARGET_DIR / name
        staging_dir.mkdir()

        for query_path in sorted(QUERIES_DIR.glob("**/*.sql")):
            sql = read_file(query_path).strip()
            unsupported = parse_unsupported(sql)
            relative_path = query_path.relative_to(QUERIES_DIR)

            def output_path(mode):
                suffix = "" if mode == "simple" else f"-{mode}"
                return staging_dir / relative_path.with_name(
                    relative_path.stem + suffix + ".plan.json"
                )

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
                try:
                    plan = get_plan(sql, mode)
                except Exception as error:
                    recover_after_error()
                    message = (
                        f"{name}: {query_path.relative_to(BASE_DIR)} ({mode}; failed: "
                        f"{str(error).splitlines()[0]})"
                    )
                    print(message)
                    failures.append(message)
                    continue
                if plan is None:
                    message = (
                        f"{name}: {query_path.relative_to(BASE_DIR)} "
                        f"({mode}; unsupported mode)"
                    )
                    print(message)
                    failures.append(message)
                    continue

                print(f"{name}: {query_path.relative_to(BASE_DIR)} ({mode})")
                destination_path = output_path(mode)
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                destination_path.write_text(plan)

        if failures:
            raise RuntimeError(f"{name}: {len(failures)} plan(s) failed")

        backup_parent = Path(tempfile.mkdtemp(prefix=f".{name}-backup-", dir=TARGET_DIR))
        backup = backup_parent / name
        try:
            if destination.exists():
                destination.rename(backup)
            staging_dir.rename(destination)
        except BaseException:
            if backup.exists():
                backup.rename(destination)
            shutil.rmtree(backup_parent)
            raise
        else:
            shutil.rmtree(backup_parent)


def dump_postgres_compatible(name, dsn):
    if not dsn:
        print(f"Skipping {name}: no DSN configured")
        return

    try:
        connection = psycopg2.connect(dsn)
    except psycopg2.OperationalError as error:
        print(f"Skipping {name}: {str(error).splitlines()[0]}")
        return

    connection.autocommit = True
    with connection:
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
            rows = list(read_rows(path))
            placeholders = ", ".join(["%s"] * len(rows[0]))
            with connection.cursor() as cursor:
                cursor.executemany(f"INSERT INTO {table} VALUES ({placeholders})", rows)

        def setup():
            run_setup(exec_stmt)
            load_tables(load_table)
            connection.commit()

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
                plans = {}
                with connection.cursor() as cursor:
                    for step in optimizer_steps:
                        cursor.execute(
                            f"EXPLAIN (VERBOSE, FORMAT JSON, STEP {step}) " + sql
                        )
                        plan = cursor.fetchone()[0]
                        if isinstance(plan, str):
                            plan = json.loads(plan[plan.index("{"):])
                        plans[step] = plan
                return format_json(plans)
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
                    events = [
                        {
                            "queryId": query_id,
                            "eventId": event_id,
                            "depth": depth,
                            "step": step,
                            "sourceLocation": source_location,
                            "changed": changed,
                            "durationUs": duration_us,
                            "plan": parse_umbra_step_plan(plan_json),
                        }
                        for (
                            query_id,
                            event_id,
                            depth,
                            step,
                            source_location,
                            changed,
                            duration_us,
                            plan_json,
                        ) in cursor.fetchall()
                    ]
                return format_json(events)
            else:
                return None
            with connection.cursor() as cursor:
                cursor.execute(explain + sql)
                return format_json(cursor.fetchone()[0])

        dump_plans(name, setup, get_plan, connection.rollback)


def parse_mariadb_url(url):
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
    }
    if "unix_socket" in query:
        options["unix_socket"] = query["unix_socket"][-1]
    return options


def dump_mariadb(url):
    if not url:
        print("Skipping mariadb: --mariadb-url is not configured")
        return

    try:
        options = parse_mariadb_url(url)
        connection = pymysql.connect(**options)
    except (ValueError, pymysql.MySQLError) as error:
        print(f"Skipping mariadb: {str(error).splitlines()[0]}")
        return

    with connection:
        def exec_stmt(sql):
            with connection.cursor() as cursor:
                cursor.execute(sql)

        def load_table(table, path):
            rows = list(read_rows(path))
            placeholders = ", ".join(["%s"] * len(rows[0]))
            with connection.cursor() as cursor:
                cursor.executemany(f"INSERT INTO {table} VALUES ({placeholders})", rows)

        def setup():
            run_setup(exec_stmt, BASE_DIR / "setup.mariadb.sql")
            load_tables(load_table)
            with connection.cursor() as cursor:
                for table, _ in DATA_FILES:
                    cursor.execute(f"ANALYZE TABLE {table} PERSISTENT FOR ALL")
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
                return format_json(trace)
            else:
                return None
            with connection.cursor() as cursor:
                cursor.execute(explain + sql)
                return format_json(cursor.fetchone()[0])

        dump_plans("mariadb", setup, get_plan)


def parse_trino_url(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("expected an http:// or https:// URL")
    if parsed.password is not None:
        raise ValueError("password-authenticated Trino is not supported")
    path = [unquote(part) for part in parsed.path.split("/") if part]
    if len(path) != 2 or not all(IDENTIFIER_RE.fullmatch(part) for part in path):
        raise ValueError("URL path must be /catalog/schema using simple identifiers")
    if path[1] != "query_graphs_plan_dumper":
        raise ValueError("Trino schema must be the dedicated query_graphs_plan_dumper scratch schema")
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


def dump_trino(url):
    if not url:
        print("Skipping trino: --trino-url is not configured")
        return

    try:
        options, (catalog, schema), coordinator_url = parse_trino_url(url)
        connection = trino.dbapi.connect(catalog=catalog, **options)
        cursor = connection.cursor()
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {catalog}.{schema}")
        cursor.fetchall()
        cursor.execute(f"USE {catalog}.{schema}")
        cursor.fetchall()
    except (ValueError, trino.exceptions.TrinoConnectionError) as error:
        print(f"Skipping trino: {str(error).splitlines()[0]}")
        return

    with connection:
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

        def setup():
            run_setup(exec_stmt, BASE_DIR / "setup.trino.sql")
            load_tables(load_table)

        def get_plan(sql, mode):
            query = sql.rstrip().removesuffix(";")
            if mode == "simple":
                cursor.execute("EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON) " + query)
                return format_json(cursor.fetchone()[0])
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

        dump_plans("trino", setup, get_plan)


def dump_duckdb():
    with duckdb.connect() as connection:
        def exec_stmt(sql):
            connection.execute(sql)

        def load_table(table, path):
            exec_stmt(
                f"COPY {table} FROM '{path}' "
                "(format csv, delimiter '|', allow_quoted_nulls false)"
            )

        def setup():
            run_setup(exec_stmt)
            load_tables(load_table)

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

        dump_plans("duckdb", setup, get_plan)


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

            def load_table(table, path):
                exec_stmt(f"COPY {table} FROM '{path}' (format csv, delimiter '|')")

            def setup():
                run_setup(exec_stmt)
                load_tables(load_table)

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
                try:
                    result = connection.execute_list_query(
                        f"EXPLAIN ({options[mode]}) " + sql
                    )
                except Exception as error:
                    if "unknown explain option" in str(error).lower():
                        return None
                    raise
                return "\n".join(row[0] for row in result)

            dump_plans("hyper", setup, get_plan)


def main():
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
