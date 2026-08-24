-- MODES: pipelines
-- UNION ALL: three independent arms feed one union-all target, so that target
-- belongs to all three arm pipelines (multi-segment bars, and a gradient edge
-- above it).
SELECT a1 FROM t1 UNION ALL SELECT a2 FROM t2 UNION ALL SELECT c1 FROM t1;
