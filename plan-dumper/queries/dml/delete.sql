--- DML queries are intentionally limited to simple mode because ANALYZE
--- executes the mutation and would change the shared setup state.
--- MODES: simple
DELETE FROM t2
WHERE a2 < 10
RETURNING a2, b2
