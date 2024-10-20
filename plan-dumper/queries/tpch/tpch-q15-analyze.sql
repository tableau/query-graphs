-- This query is derived from TPC-H query 15
-- THE TPC SOFTWARE IS AVAILABLE WITHOUT CHARGE FROM TPC.

with revenue as (
	select
		l_suppkey as supplier_no,
		sum(l_extendedprice * (1 - l_discount)) as total_revenue
	from
		lineitem
	where
		l_shipdate >= date '1996-01-01'
		and l_shipdate < date '1996-04-01'
	group by
		l_suppkey)
select
	s_suppkey,
	s_name,
	s_address,
	s_phone,
	total_revenue
from
	supplier,
	revenue
where
	s_suppkey = supplier_no
	and total_revenue = (
		select
			max(total_revenue)
		from
			revenue
	)
order by
	s_suppkey
