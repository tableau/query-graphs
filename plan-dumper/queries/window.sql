SELECT l_orderkey,
    SUM(l_quantity) OVER (ORDER BY l_orderkey),
    AVG(l_extendedprice) OVER (ORDER BY l_shipdate ROWS BETWEEN 1 PRECEDING AND 3 FOLLOWING)
FROM lineitem
