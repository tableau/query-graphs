-- Exercise an optional edge and ONE ROW PER STEP on the TPC-H part/supplier
-- relationship. The optional edge also gives the sqlpos implementation a
-- concrete absent-edge branch to annotate.
EXPLAIN (FORMAT INTERNAL)
WITH pg AS PROPERTY GRAPH (
    VERTEX TABLES (
        part KEY (p_partkey)
            LABEL Product
            PROPERTIES (part.p_name AS name),
        supplier KEY (s_suppkey)
            LABEL Supplier
            PROPERTIES (supplier.s_name AS name)
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
    MATCH (product:Product)-[supply:Supply]->?(vendor:Supplier)
    ONE ROW PER STEP (source_step, edge_step, destination_step)
    COLUMNS (
        source_step.name AS product_name,
        edge_step.supply_cost AS supply_cost,
        destination_step.name AS supplier_name
    )
) AS matched