-- MODES: analyze, pipelines, analyze-pipelines
-- Under pipelines: a correlated scalar subquery is lowered to a magic set; operators are
-- shared between the magic groupBy and the outer join.
SELECT o_orderkey, (SELECT SUM(l_quantity) FROM lineitem WHERE l_extendedprice < o_totalprice) FROM orders
