import re


config_comment_re = re.compile(r"^[ \t]*---[^\r\n]*(?:\r?\n|$)", re.MULTILINE)


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
