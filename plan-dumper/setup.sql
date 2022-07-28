-- Ad-hoc tables

CREATE TEMP TABLE t1 (a1 int, b1 int, c1 int);
CREATE TEMP TABLE t2 (a2 int, b2 int, c2 int);

-- The TPC-H schema

CREATE TEMP TABLE part (
   p_partkey integer not null,
   p_name varchar(55) not null,
   p_mfgr char(25) not null,
   p_brand char(10) not null,
   p_type varchar(25) not null,
   p_size integer not null,
   p_container char(10) not null,
   p_retailprice decimal(12,2) not null,
   p_comment varchar(23) not null
);

CREATE TEMP TABLE supplier (
   s_suppkey integer not null,
   s_name char(25) not null,
   s_address varchar(40) not null,
   s_nationkey integer not null,
   s_phone char(15) not null,
   s_acctbal decimal(12,2) not null,
   s_comment varchar(101) not null
);

CREATE TEMP TABLE partsupp (
   ps_partkey integer not null,
   ps_suppkey integer not null,
   ps_availqty integer not null,
   ps_supplycost decimal(12,2) not null,
   ps_comment varchar(199) not null
);

CREATE TEMP TABLE customer (
   c_custkey integer not null,
   c_name varchar(25) not null,
   c_address varchar(40) not null,
   c_nationkey integer not null,
   c_phone char(15) not null,
   c_acctbal decimal(12,2) not null,
   c_mktsegment char(10) not null,
   c_comment varchar(117) not null
);

CREATE TEMP TABLE orders (
   o_orderkey integer not null,
   o_custkey integer not null,
   o_orderstatus char(1) not null,
   o_totalprice decimal(12,2) not null,
   o_orderdate date not null,
   o_orderpriority char(15) not null,
   o_clerk char(15) not null,
   o_shippriority integer not null,
   o_comment varchar(79) not null
);

CREATE TEMP TABLE lineitem (
   l_orderkey integer not null,
   l_partkey integer not null,
   l_suppkey integer not null,
   l_linenumber integer not null,
   l_quantity decimal(12,2) not null,
   l_extendedprice decimal(12,2) not null,
   l_discount decimal(12,2) not null,
   l_tax decimal(12,2) not null,
   l_returnflag char(1) not null,
   l_linestatus char(1) not null,
   l_shipdate date not null,
   l_commitdate date not null,
   l_receiptdate date not null,
   l_shipinstruct char(25) not null,
   l_shipmode char(10) not null,
   l_comment varchar(44) not null
);

CREATE TEMP TABLE nation (
   n_nationkey integer not null,
   n_name char(25) not null,
   n_regionkey integer not null,
   n_comment varchar(152) not null
);

CREATE TEMP TABLE region (
   r_regionkey integer not null,
   r_name char(25) not null,
   r_comment varchar(152) not null
);

-- We also load some data into the TPC-H schema because our query plans depend on cardinality estimates and we want meaningful numbers there.
-- Unfortunately, I am not sure about the license of the TPC-H data and hence can't add it to the repository.
-- You will have to downloade the data on your own or just comment out the following lines and use an empty schema instead.
copy customer from './tpch-data-tiny/customer.tbl' (delimiter '|', trailing_delimiter);
copy lineitem from './tpch-data-tiny/lineitem.tbl' (delimiter '|', trailing_delimiter);
copy nation from './tpch-data-tiny/nation.tbl' (delimiter '|', trailing_delimiter);
copy orders from './tpch-data-tiny/orders.tbl' (delimiter '|', trailing_delimiter);
copy partsupp from './tpch-data-tiny/partsupp.tbl' (delimiter '|', trailing_delimiter);
copy part from './tpch-data-tiny/part.tbl' (delimiter '|', trailing_delimiter);
copy region from './tpch-data-tiny/region.tbl' (delimiter '|', trailing_delimiter);
copy supplier from './tpch-data-tiny/supplier.tbl' (delimiter '|', trailing_delimiter);
