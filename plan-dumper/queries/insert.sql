INSERT INTO t2
SELECT a1*v, b1*v, c1*v
FROM t1,
(VALUES(1), (2)) v(v)