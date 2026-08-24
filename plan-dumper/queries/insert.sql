-- UNSUPPORTED: mariadb
-- MariaDB 10.11 does not support the standard VALUES table constructor in FROM.
-- MODES: simple
INSERT INTO t2
SELECT a1*v, b1*v, c1*v
FROM t1,
(VALUES(1), (2)) v(v)