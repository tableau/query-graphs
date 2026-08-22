from tableauhyperapi import HyperProcess, Telemetry, Connection
try:
    import psycopg2
except ImportError:
    psycopg2 = None
import argparse
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
       print(f"{name}: {f}")
       sql = read_file(f)
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

       # Only Hyper supports the PIPELINES option.
       if mode in ("pipelines", "analyze-pipelines") and name != "hyper":
           continue

       plan = get_plan(sql, mode)
       if not plan:
           continue
       targetPath = targetDir / name / f.relative_to(queriesDir).with_suffix(".plan.json")
       targetPath.parent.mkdir(parents=True, exist_ok=True)
       with open(targetPath, "w") as f:
           f.write(plan)


# Postgres
if psycopg2 is not None:
    with psycopg2.connect("port=5433") as conn:
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
else:
    print("Skipping Postgres: psycopg2 not installed")


# Umbra / CedarDB (CedarDB is built on top of Umbra; both emit the same EXPLAIN JSON
# format, so a single DSN drives whichever product is running locally).
umbra_dsn = os.environ.get("UMBRA_DSN")
if psycopg2 is None:
    print("Skipping Umbra/CedarDB: psycopg2 not installed")
elif not umbra_dsn:
    print("Skipping Umbra/CedarDB: set UMBRA_DSN to enable, e.g. "
          "UMBRA_DSN=\"host=127.0.0.1 port=5599 user=postgres password=...\"")
else:
    def connect_umbra():
        new_conn = psycopg2.connect(umbra_dsn)
        # Autocommit: a failing EXPLAIN (see below) must not abort the transaction that
        # created the temp tables in `setup.sql`.
        new_conn.autocommit = True
        return new_conn

    def run_umbra_setup(conn):
        with conn.cursor() as cur:
            for stmt in read_file(setupFile).split(";"):
                copy_and_overwrite("./tpch-data-tiny", "/tmp/tpch-data-tiny")
                s = stmt.replace("./tpch-data-tiny", "/tmp/tpch-data-tiny")
                if s.strip() != "":
                    cur.execute(s)

    try:
        umbra_conn = connect_umbra()
    except psycopg2.OperationalError as e:
        umbra_conn = None
        print(f"Skipping Umbra/CedarDB: {e}")
    if umbra_conn is not None:
        state = {"conn": umbra_conn}

        def exec_umbra(sql):
            with state["conn"].cursor() as cur:
                if sql.strip() != "":
                    cur.execute(sql)

        def get_umbra_plan(sql, mode):
            if state["conn"] is None:
                return None
            if mode in ("steps", "pipelines", "analyze-pipelines"):
                return None
            elif mode == "analyze":
                explain = "EXPLAIN (ANALYZE, FORMAT JSON) "
            elif mode is None:
                explain = "EXPLAIN (FORMAT JSON) "
            else:
                return None
            try:
                with state["conn"].cursor() as cur:
                    cur.execute(explain + sql)
                    return cur.fetchall()[0][0]
            except Exception as e:
                # Some queries are deliberately Hyper-specific (e.g. the ANALYZE-with-error
                # test) or hit engine bugs; skip them rather than aborting the whole dump.
                # A failed statement can leave the session unable to see its own temp tables
                # afterwards, so reconnect and redo `setup.sql` before the next query.
                print(f"  skipping, query failed: {str(e).splitlines()[0]}")
                state["conn"].close()
                try:
                    state["conn"] = connect_umbra()
                    run_umbra_setup(state["conn"])
                except Exception as reconnect_error:
                    print(f"  could not recover Umbra/CedarDB session, skipping remaining queries: {reconnect_error}")
                    state["conn"] = None
                return None

        dump_plans("umbra", exec_umbra, get_umbra_plan)


parser = argparse.ArgumentParser()
parser.add_argument("--hyper-path", type=Path, default=None,
                    help="Path to a directory containing the hyperd binary. "
                         "Uses the pip-installed Hyper by default.")
args = parser.parse_args()

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
