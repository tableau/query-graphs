-- Same query as magicunnesting.sql, dumped with PIPELINES. A correlated scalar
-- subquery is lowered to a magic set; operators are shared between the magic
-- groupBy and the outer join.
SELECT a1, (SELECT SUM(a2) FROM t2 WHERE a2 < a1) FROM t1
