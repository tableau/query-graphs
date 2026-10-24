--- UNSUPPORTED: umbra, cedardb, mariadb
--- Umbra, CedarDB, and MariaDB do not implement TABLESAMPLE SYSTEM or BERNOULLI.
SELECT a1, b1, c1
FROM t1 TABLESAMPLE SYSTEM (50)
REPEATABLE (1)
