\include setup_schema.sql;

\copy customer tpch-data-tiny/customer.tbl;
\copy lineitem tpch-data-tiny/lineitem.tbl;
\copy nation tpch-data-tiny/nation.tbl;
\copy orders tpch-data-tiny/orders.tbl;
\copy partsupp tpch-data-tiny/partsupp.tbl;
\copy part tpch-data-tiny/part.tbl;
\copy region tpch-data-tiny/region.tbl;
\copy supplier tpch-data-tiny/supplier.tbl;
