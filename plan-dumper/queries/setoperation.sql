-- Exercise every set-operation variant, including n-ary and nested trees.
-- Keeping the arms independent gives optimizers an opportunity to flatten the
-- UNION/INTERSECT/EXCEPT chains into n-ary operators.
SELECT 'union' AS operation, value
FROM (
    SELECT a1 AS value FROM t1 WHERE a1 < 10
    UNION
    SELECT b1 FROM t1 WHERE b1 < 10
    UNION
    SELECT c1 FROM t1 WHERE c1 < 10
) u
UNION ALL
SELECT 'union-all', value
FROM (
    SELECT a1 AS value FROM t1 WHERE a1 >= 10
    UNION ALL
    SELECT b1 FROM t1 WHERE b1 >= 10
    UNION ALL
    SELECT c1 FROM t1 WHERE c1 >= 10
) ua
UNION ALL
SELECT 'intersect', value
FROM (
    SELECT a1 AS value FROM t1
    INTERSECT
    SELECT b1 FROM t1
    INTERSECT
    SELECT c1 FROM t1
) i
UNION ALL
SELECT 'intersect-all', value
FROM (
    SELECT a1 AS value FROM t1
    INTERSECT ALL
    SELECT b1 FROM t1
    INTERSECT ALL
    SELECT c1 FROM t1
) ia
UNION ALL
SELECT 'except', value
FROM (
    SELECT a1 AS value FROM t1
    EXCEPT
    SELECT b1 FROM t1
    EXCEPT
    SELECT c1 FROM t1
) e
UNION ALL
SELECT 'except-all', value
FROM (
    SELECT a1 AS value FROM t1
    EXCEPT ALL
    SELECT b1 FROM t1
    EXCEPT ALL
    SELECT c1 FROM t1
) ea
