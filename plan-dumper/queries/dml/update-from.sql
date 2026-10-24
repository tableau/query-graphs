--- DML queries are intentionally limited to simple mode because ANALYZE
--- executes the mutation and would change the shared setup state.
--- UNSUPPORTED: mariadb
--- MariaDB does not support PostgreSQL's UPDATE ... FROM syntax.
--- MODES: simple
UPDATE t2
SET a2 = t1.a1 + 1,
    b2 = t1.b1
FROM t1
WHERE t2.a2 = t1.a1
RETURNING t2.a2, t2.b2
