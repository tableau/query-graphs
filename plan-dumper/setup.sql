\include setup_schema.sql;

COPY customer FROM './tpch-data-tiny/customer.tbl' (format csv, delimiter '|');
COPY lineitem FROM './tpch-data-tiny/lineitem.tbl' (format csv, delimiter '|');
COPY nation FROM './tpch-data-tiny/nation.tbl' (format csv, delimiter '|');
COPY orders FROM './tpch-data-tiny/orders.tbl' (format csv, delimiter '|');
COPY partsupp FROM './tpch-data-tiny/partsupp.tbl' (format csv, delimiter '|');
COPY part FROM './tpch-data-tiny/part.tbl' (format csv, delimiter '|');
COPY region FROM './tpch-data-tiny/region.tbl' (format csv, delimiter '|');
COPY supplier FROM './tpch-data-tiny/supplier.tbl' (format csv, delimiter '|');
