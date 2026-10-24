-- For this query, the engine must ensure that the subquery returns at most
-- one row. The optimizer cannot prove this, so that assertion must be
-- preserved in the query plan somehow.
EXPLAIN (VERBOSE, ANALYZE, FORMAT JSON)
SELECT t1.a1,
       (SELECT t2.b2 FROM t2) AS matching_b
FROM t1