from tableauhyperapi import HyperProcess, Telemetry, Connection
from pathlib import Path

setupFile = Path("./setup.sql")
queriesDir = Path("./queries")
targetDir = Path("../standalone-app/examples/hyper/")
params = {
    "log_config": ""
}

def read_file(p):
    with open(p) as f:
        return f.read()

with HyperProcess(telemetry=Telemetry.SEND_USAGE_DATA_TO_TABLEAU, parameters=params) as hyper:
    with Connection(endpoint=hyper.endpoint) as connection:
        # run setup script
        setupSql = read_file(setupFile)
        for stmt in setupSql.split(";"):
            connection.execute_command(stmt)

        # dump the plans      
        for f in queriesDir.glob("**/*.sql"):
            print(f)
            sql = read_file(f)
            explain = "EXPLAIN (VERBOSE, OPTIMIZERSTEPS) " if str(f).endswith("-steps.sql") else "EXPLAIN (VERBOSE) ";
            planRes = connection.execute_list_query(explain + sql)
            targetPath = targetDir / f.relative_to(queriesDir).with_suffix(".plan.json")
            plan = "\n".join(r[0] for r in planRes)
            with open(targetPath, "w") as f:
                f.write(plan)
