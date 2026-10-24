-- A correlated scalar subquery is lowered to a single join on Hyper. The
-- correlation makes the inner query depend on the current outer row.
EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON)
SELECT t1.a1,
       (SELECT t2.b2 FROM t2 WHERE t2.a2 = t1.a1) AS matching_b
FROM t1