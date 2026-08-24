SELECT *, EXISTS (SELECT * FROM partsupp WHERE ps_suppkey = s_suppkey AND s_acctbal < ps_supplycost) FROM supplier
