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
   for f in queriesDir.glob("**/*.sql"):
       print(f"{name}: {f}")
       sql = read_file(f)
       if str(f).endswith("-steps.sql"):
           plan = get_plan(sql, "steps")
       elif str(f).endswith("-analyze.sql"):
           plan = get_plan(sql, "analyze")
       else:
           plan = get_plan(sql, None)
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
                explain = "EXPLAIN (FORMAT JSON, OPTIMIZE STEPS) "
            elif mode == "analyze":
                explain = "EXPLAIN (FORMAT JSON, ANALYZE) "
            elif mode is None:
                explain = "EXPLAIN (FORMAT JSON) "
            else:
                return None
            planRes = connection.execute_list_query(explain + sql)
            plan = "\n".join(r[0] for r in planRes)
            return plan

        dump_plans("hyper", exec_hyper, get_hyper_plan)
