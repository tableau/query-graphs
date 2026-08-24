SELECT l_returnflag, SUM(l_quantity), AVG(l_discount)
FROM lineitem
GROUP BY l_returnflag
