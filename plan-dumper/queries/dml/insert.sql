--- MODES: simple
--- DML queries are intentionally limited to simple mode because ANALYZE
--- executes the mutation and would change the shared setup state.
INSERT INTO t2 (a2, b2, c2)
SELECT a1, b1, c1
FROM t1
RETURNING a2, b2, c2
