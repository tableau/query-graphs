-- MODES: pipelines
-- Materialized share: the same shared scan feeds both sides of a self-join. The
-- build and probe pipelines depend on each other, so the share cannot be forked;
-- it is materialized into a temp that both explicit scans read, and the pipeline
-- breaks at the share.
WITH v AS (SELECT a1 FROM t1 WHERE b1 < 5) SELECT * FROM v a JOIN v b ON a.a1 = b.a1;
