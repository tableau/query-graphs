EXPLAIN (ANALYZE, FORMAT JSON)
WITH base AS (
    SELECT l_orderkey, l_partkey, l_quantity, l_extendedprice
    FROM lineitem
), filtered AS (
    SELECT *
    FROM base
    WHERE l_quantity > 1
), grouped AS (
    SELECT l_orderkey, SUM(l_quantity) AS quantity, AVG(l_extendedprice) AS price
    FROM filtered
    GROUP BY l_orderkey
), nested AS (
    WITH nested_filtered AS (
        SELECT l_orderkey, quantity
        FROM grouped
        WHERE quantity > 10
    )
    SELECT l_orderkey, quantity
    FROM nested_filtered
), reused AS (
    SELECT l_orderkey, quantity FROM nested
    UNION ALL
    SELECT l_orderkey, quantity FROM nested
)
SELECT r.l_orderkey, r.quantity, g.price
FROM reused r
JOIN grouped g ON g.l_orderkey = r.l_orderkey