-- MariaDB variant of setup.sql.
-- It uses non-temporary tables because persistent statistics cannot be
-- collected for temporary tables.

DROP TABLE IF EXISTS t1;
DROP TABLE IF EXISTS t2;
DROP TABLE IF EXISTS part;
DROP TABLE IF EXISTS supplier;
DROP TABLE IF EXISTS partsupp;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS lineitem;
DROP TABLE IF EXISTS nation;
DROP TABLE IF EXISTS region;

-- Ad-hoc tables

CREATE TABLE t1 (a1 int, b1 int, c1 int);
CREATE TABLE t2 (a2 int, b2 int, c2 int);

-- The TPC-H schema

CREATE TABLE part (
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

CREATE TABLE supplier (
   s_suppkey integer not null,
   s_name char(25) not null,
   s_address varchar(40) not null,
   s_nationkey integer not null,
   s_phone char(15) not null,
   s_acctbal decimal(12,2) not null,
   s_comment varchar(101) not null
);

CREATE TABLE partsupp (
   ps_partkey integer not null,
   ps_suppkey integer not null,
   ps_availqty integer not null,
   ps_supplycost decimal(12,2) not null,
   ps_comment varchar(199) not null
);

CREATE TABLE customer (
   c_custkey integer not null,
   c_name varchar(25) not null,
   c_address varchar(40) not null,
   c_nationkey integer not null,
   c_phone char(15) not null,
   c_acctbal decimal(12,2) not null,
   c_mktsegment char(10) not null,
   c_comment varchar(117) not null
);

CREATE TABLE orders (
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

CREATE TABLE lineitem (
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

CREATE TABLE nation (
   n_nationkey integer not null,
   n_name char(25) not null,
   n_regionkey integer not null,
   n_comment varchar(152) not null
);

CREATE TABLE region (
   r_regionkey integer not null,
   r_name char(25) not null,
   r_comment varchar(152) not null
);

LOAD DATA LOCAL INFILE './tpch-data-tiny/customer.tbl'
INTO TABLE customer FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/lineitem.tbl'
INTO TABLE lineitem FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/nation.tbl'
INTO TABLE nation FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/orders.tbl'
INTO TABLE orders FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/partsupp.tbl'
INTO TABLE partsupp FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/part.tbl'
INTO TABLE part FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/region.tbl'
INTO TABLE region FIELDS TERMINATED BY '|';
LOAD DATA LOCAL INFILE './tpch-data-tiny/supplier.tbl'
INTO TABLE supplier FIELDS TERMINATED BY '|';

ANALYZE TABLE customer, lineitem, nation, orders, partsupp, part, region, supplier
PERSISTENT FOR ALL;
