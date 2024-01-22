WITH cte AS (SELECT a1, SUM(b1), AVG(c1)
   FROM t1
   GROUP BY a1
)
SELECT * FROM cte UNION ALL SELECT * FROM cte
