\include setup_schema.sql;

COPY customer FROM './tpch-data-tiny/customer.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY lineitem FROM './tpch-data-tiny/lineitem.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY nation FROM './tpch-data-tiny/nation.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY orders FROM './tpch-data-tiny/orders.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY partsupp FROM './tpch-data-tiny/partsupp.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY part FROM './tpch-data-tiny/part.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY region FROM './tpch-data-tiny/region.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
COPY supplier FROM './tpch-data-tiny/supplier.tbl' (format csv, delimiter '|', allow_quoted_nulls false);
