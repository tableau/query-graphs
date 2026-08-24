from tableauhyperapi import HyperProcess, Telemetry, Connection
import duckdb
try:
    import psycopg2
except ImportError:
    psycopg2 = None
import argparse
import re
import shutil
import os
import json
from pathlib import Path

setupFile = Path("./setup.sql")
queriesDir = Path("./queries")
targetDir = Path("../standalone-app/examples/")
hyper_params = {
    "log_config": ""
}


# Parse command line arguments
parser = argparse.ArgumentParser()
parser.add_argument("--hyper-path", type=Path, default=None,
                    help="Path to a directory containing the hyperd binary. "
                         "Uses the pip-installed Hyper by default.")
args = parser.parse_args()


# A `-- UNSUPPORTED: duckdb, postgres` comment anywhere in a query file lists the databases
# that can't run it (incompatible syntax, or a semantic difference like division-by-zero
# handling); those databases skip the file instead of erroring out mid-run.
unsupportedRe = re.compile(r"^--\s*UNSUPPORTED:\s*(.+)$", re.MULTILINE | re.IGNORECASE)


def parse_unsupported(sql):
    m = unsupportedRe.search(sql)
    if not m:
        return set()
    return {db.strip().lower() for db in m.group(1).split(",")}


def copy_and_overwrite(from_path, to_path):
    if os.path.exists(to_path):
        shutil.rmtree(to_path)
    shutil.copytree(from_path, to_path)


def read_file(p):
    with open(p) as f:
        return f.read()



def dump_plans(name, exec_stmt, get_plan):
   # run setup script
   setupSql = read_file(setupFile)
   for stmt in setupSql.split(";"):
       copy_and_overwrite("./tpch-data-tiny", "/tmp/tpch-data-tiny")
       exec_stmt(stmt.replace("./tpch-data-tiny", "/tmp/tpch-data-tiny"))

   # dump the plans
   for f in sorted(queriesDir.glob("**/*.sql")):
       sql = read_file(f)
       if name in parse_unsupported(sql):
           print(f"{name}: {f} (skipped, marked UNSUPPORTED)")
           continue
       print(f"{name}: {f}")
       fname = f.name
       if fname.endswith("-steps.sql"):
           mode = "steps"
       elif fname.endswith("-analyze-pipelines.sql"):
           mode = "analyze-pipelines"
       elif fname.endswith("-pipelines.sql"):
           mode = "pipelines"
       elif fname.endswith("-analyze.sql"):
           mode = "analyze"
       else:
           mode = None

       plan = get_plan(sql, mode)
       if not plan:
           continue
       targetPath = targetDir / name / f.relative_to(queriesDir).with_suffix(".plan.json")
       targetPath.parent.mkdir(parents=True, exist_ok=True)
       with open(targetPath, "w") as f:
           f.write(plan)


# Postgres
with psycopg2.connect("port=5432") as conn:
    def exec_postgres(sql):
        with conn.cursor() as cur:
            if sql.strip() != "":
                cur.execute(sql)

    def get_postgres_plan(sql, mode):
        if mode == "steps":
            return None
        elif mode == "analyze":
            explain = "EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON) "
        elif mode is None:
            explain = "EXPLAIN (VERBOSE, FORMAT JSON) "
        else:
            return None
        with conn.cursor() as cur:
            cur.execute(explain + sql)
            records = cur.fetchall()
            return json.dumps(records[0][0])

    dump_plans("postgres", exec_postgres, get_postgres_plan)


# DuckDB
with duckdb.connect() as duckdb_con:
    def exec_duckdb(sql):
        # Unlike Postgres and Hyper, DuckDB's CSV reader by default treats a quoted empty
        # field (`""`, used by the tiny TPC-H dataset for empty comment columns) as NULL
        # rather than as an empty string, which then trips the NOT NULL column constraints.
        sql = sql.replace("(format csv, delimiter '|')", "(format csv, delimiter '|', allow_quoted_nulls false)")
        if sql.strip() != "":
            duckdb_con.execute(sql)

    def get_duckdb_plan(sql, mode):
        if mode is None:
            duckdb_con.execute("SET explain_output='physical_only'")
            explain = "EXPLAIN (FORMAT JSON) "
        elif mode == "analyze":
            duckdb_con.execute("SET explain_output='physical_only'")
            explain = "EXPLAIN (ANALYZE, FORMAT JSON) "
        elif mode == "steps":
            # `explain_output='all'` returns one row per optimizer stage (logical_plan,
            # logical_opt, physical_plan) instead of just the final physical plan.
            duckdb_con.execute("SET explain_output='all'")
            explain = "EXPLAIN (FORMAT JSON) "
        else:
            return None
        records = duckdb_con.execute(explain + sql).fetchall()
        if mode == "steps":
            return json.dumps({stage: json.loads(plan) for stage, plan in records}, indent=2)
        return records[0][1]

    dump_plans("duckdb", exec_duckdb, get_duckdb_plan)


# Hyper
with HyperProcess(telemetry=Telemetry.SEND_USAGE_DATA_TO_TABLEAU, parameters=hyper_params, hyper_path=args.hyper_path) as hyper:
    with Connection(endpoint=hyper.endpoint) as connection:
        def exec_hyper(sql):
            connection.execute_command(sql)

        def get_hyper_plan(sql, mode):
            if mode == "steps":
                explain = "EXPLAIN (FORMAT INTERNAL, OPTIMIZE STEPS) "
            elif mode == "analyze":
                explain = "EXPLAIN (FORMAT INTERNAL, ANALYZE) "
            elif mode == "pipelines":
                explain = "EXPLAIN (FORMAT INTERNAL, PIPELINES, EXPAND_VIEWS true, EXPRESSIONS SQL) "
            elif mode == "analyze-pipelines":
                explain = "EXPLAIN (FORMAT INTERNAL, PIPELINES, ANALYZE, EXPAND_VIEWS true, EXPRESSIONS SQL) "
            elif mode is None:
                explain = "EXPLAIN (FORMAT INTERNAL) "
            else:
                return None
            planRes = connection.execute_list_query(explain + sql)
            plan = "\n".join(r[0] for r in planRes)
            return plan

        dump_plans("hyper", exec_hyper, get_hyper_plan)
