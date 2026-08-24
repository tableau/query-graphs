-- UNSUPPORTED: trino:analyze
-- Trino's default recursion limit rejects this 100-step query; raising the limit
-- instead causes a stack overflow during analysis on Trino 434.
WITH RECURSIVE x(i) AS (
    SELECT 1
    UNION ALL
    SELECT i + 1 FROM x WHERE i < 100
)
SELECT * FROM x;
