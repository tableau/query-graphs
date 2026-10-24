--- UNSUPPORTED: postgres, duckdb, umbra, cedardb, mariadb
--- SQL/PGQ is currently only available in Hyper.
--- Simple mode is sufficient here because the fixture targets PGQ's
--- relational lowering and does not need runtime measurements.
--- MODES: simple, steps

-- Match parts to their suppliers, using labels and projected properties from
-- the shared TPC-H schema.
WITH pg AS PROPERTY GRAPH (
    VERTEX TABLES (
        part KEY (p_partkey)
            LABEL Product
            PROPERTIES (part.p_name AS name, part.p_brand AS brand),
        supplier KEY (s_suppkey)
            LABEL Supplier
            PROPERTIES (supplier.s_name AS name, supplier.s_acctbal AS account_balance)
    )
    EDGE TABLES (
        partsupp KEY (ps_partkey, ps_suppkey)
            SOURCE KEY (ps_partkey) REFERENCES part
            DESTINATION KEY (ps_suppkey) REFERENCES supplier
            LABEL Supply
            PROPERTIES (partsupp.ps_supplycost AS supply_cost)
    )
)
SELECT *
FROM GRAPH_TABLE(pg
    MATCH (
        product:Product WHERE product.brand = 'Brand#11'
    )-[
        supply:Supply WHERE supply.supply_cost > 100
    ]->(
        vendor:Supplier WHERE vendor.account_balance > 0
    )
    WHERE product.name LIKE '%blue%'
    COLUMNS (
        product.name AS product_name,
        supply.supply_cost AS supply_cost,
        vendor.name AS supplier_name
    )
) AS matched
