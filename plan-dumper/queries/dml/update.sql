--- MODES: simple
--- DML queries are intentionally limited to simple mode because ANALYZE
--- executes the mutation and would change the shared setup state.
UPDATE t2
SET a2 = a2 + 1,
    b2 = b2 + 1
WHERE a2 < 10
