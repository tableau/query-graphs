WITH cte AS (SELECT l_orderkey, SUM(l_quantity), AVG(l_extendedprice)
   FROM lineitem
   GROUP BY l_orderkey
)
SELECT * FROM cte UNION ALL SELECT * FROM cte
