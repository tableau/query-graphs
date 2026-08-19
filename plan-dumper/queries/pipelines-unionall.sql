-- Source: hyper/sql/functional/features/explain/pipeline_graph.test (hyper-db#13438)
-- share_forking OFF: a LIMIT CTE feeding three UNION ALL arms. The shared source
-- pipeline is a dependency of every arm, and the union-target operators recur in
-- each arm's pipeline.
SET global.share_forking=0;
SET global.view_inlining_selectivity_threshold=1;
WITH v1 AS (SELECT index AS a FROM SEQUENCE(1, 6) ORDER BY index LIMIT 3) (SELECT a FROM v1) UNION ALL (SELECT a FROM v1) UNION ALL (SELECT a FROM v1);
