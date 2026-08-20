-- Magic set: a correlated EXISTS is lowered to a magic set, so operators are
-- shared between the magic groupBy and the semi-join and the pipelines have
-- multiple dependencies.
SELECT * FROM t1 WHERE EXISTS (SELECT 1 FROM t2 WHERE t1.a1 > t2.a2 GROUP BY t2.b2 HAVING COUNT(*) > 0);
