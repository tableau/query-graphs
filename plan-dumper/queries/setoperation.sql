SELECT l_orderkey, l_partkey FROM lineitem
UNION ALL
SELECT l_orderkey, l_suppkey FROM lineitem
UNION ALL
(
   SELECT l_suppkey, l_partkey FROM lineitem
   WHERE l_quantity < 25
   INTERSECT ALL
   SELECT l_suppkey, l_partkey FROM lineitem
   WHERE l_quantity >= 25
   EXCEPT ALL
   SELECT l_suppkey, l_partkey FROM lineitem
   WHERE l_quantity >= 25
)
