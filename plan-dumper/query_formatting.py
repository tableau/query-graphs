import re


config_comment_re = re.compile(r"^[ \t]*---[^\r\n]*(?:\r?\n|$)", re.MULTILINE)

CEDARDB_OPTIMIZER_STEPS = (
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


def parse_config(sql, name):
    match = re.search(
        rf"^[ \t]*---\s*{re.escape(name)}:\s*(.+)$",
        sql,
        re.MULTILINE | re.IGNORECASE,
    )
    if not match:
        return []
    return [value.strip().lower() for value in match.group(1).split(",")]


def strip_config_comments(sql):
    return config_comment_re.sub("", sql)


def explain_query(sql, explain):
    lines = sql.splitlines(keepends=True)
    insertion = 0
    while insertion < len(lines):
        line = lines[insertion].lstrip()
        if line.strip() and not line.startswith("--"):
            break
        insertion += 1
    lines.insert(insertion, explain + "\n")
    return "".join(lines)


def explain_queries(engine, mode, sql):
    if engine in ("postgres", "umbra", "cedardb"):
        if mode == "simple":
            prefixes = ["EXPLAIN (VERBOSE, FORMAT JSON)"]
        elif mode == "analyze":
            prefixes = ["EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON)"]
        elif engine == "cedardb" and mode == "steps":
            prefixes = [
                f"EXPLAIN (VERBOSE, FORMAT JSON, STEP {step})"
                for step in CEDARDB_OPTIMIZER_STEPS
            ]
        else:
            return None
    elif engine == "mariadb":
        prefixes = {
            "simple": ["EXPLAIN FORMAT=JSON"],
            "analyze": ["ANALYZE FORMAT=JSON"],
            "steps": ["EXPLAIN FORMAT=JSON"],
        }.get(mode)
    elif engine == "duckdb":
        prefixes = {
            "simple": ["EXPLAIN (FORMAT JSON)"],
            "analyze": ["EXPLAIN (ANALYZE, FORMAT JSON)"],
            "steps": ["EXPLAIN (FORMAT JSON)"],
        }.get(mode)
    elif engine == "hyper":
        options = {
            "simple": "FORMAT INTERNAL",
            "steps": "FORMAT INTERNAL, OPTIMIZE STEPS",
            "analyze": "FORMAT INTERNAL, ANALYZE",
            "external-analyze": "FORMAT JSON, ANALYZE, EXPAND_VIEWS true",
            "analyze-sql": "FORMAT INTERNAL, ANALYZE, EXPRESSIONS SQL",
        }
        prefixes = [f"EXPLAIN ({options[mode]})"] if mode in options else None
    else:
        return None

    return None if prefixes is None else [explain_query(sql, prefix) for prefix in prefixes]


def generate_example_sql(index, queries_dir):
    result = {}
    for engine, engine_index in index["engines"].items():
        for query, modes in engine_index["queries"].items():
            query_file = (queries_dir / f"{query}.sql").read_text().strip()
            sql = strip_config_comments(query_file).strip()
            for mode, files in modes.items():
                queries = explain_queries(engine, mode, sql)
                if queries is None:
                    raise ValueError(f"unsupported engine/mode in index: {engine}/{mode}")
                sql_path = files["sql"]
                if sql_path in result:
                    raise ValueError(f"duplicate SQL path in index: {sql_path}")
                result[sql_path] = "\n\n".join(queries)
    return result
