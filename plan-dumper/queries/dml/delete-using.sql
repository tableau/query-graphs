--- DML queries are intentionally limited to simple mode because ANALYZE
--- executes the mutation and would change the shared setup state.
--- UNSUPPORTED: mariadb
--- MariaDB supports DELETE ... USING, but does not allow RETURNING on
--- multi-table DELETE statements.
--- MODES: simple
DELETE FROM t2
USING t1
WHERE t2.a2 = t1.a1
RETURNING t2.a2, t2.b2
