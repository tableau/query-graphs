-- UNSUPPORTED: postgres, umbra, cedardb, mariadb, trino
-- MODES: analyze
-- Postgres raises a hard "division by zero" error for the `/ 0` below, aborting the whole
-- dump; DuckDB returns `inf` instead (no error, so it still dumps, just without exercising
-- the error-reporting path this query is meant to test).
--
-- This query is derived from TPC-H query 11
-- THE TPC SOFTWARE IS AVAILABLE WITHOUT CHARGE FROM TPC.
-- The query was modified so that errors out during execution.
-- We use it to test reporting of errors when running `ANALYZE`.

select
        ps_partkey,
        sum(ps_supplycost * ps_availqty) as "value"
from
        partsupp,
        supplier,
        nation
where
        ps_suppkey = s_suppkey
        and s_nationkey = n_nationkey
        and n_name = 'GERMANY'
group by
        ps_partkey having
                sum(ps_supplycost * ps_availqty) > (
                        select
                                sum(ps_supplycost * ps_availqty) * 0.0001
                        from
                                partsupp,
                                supplier,
                                nation
                        where
                                ps_suppkey = s_suppkey
                                and s_nationkey = n_nationkey
                                and n_name = 'GERMANY'
                ) / 0
order by
        "value" desc
