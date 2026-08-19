-- Source: hyper/sql/functional/features/explain/pipeline_graph.test (hyper-db#13438)
-- Share-forked CTE feeding MIN and MAX of a FULL OUTER JOIN: the shared scan
-- recurs across the pipelines that compute the two aggregates.
SET global.share_forking=1;
SET global.view_inlining_selectivity_threshold=1;
CREATE TEMPORARY TABLE pipeline_graph_t (i int);
WITH v1 AS (SELECT i FROM pipeline_graph_t) SELECT * FROM (SELECT MIN(i) AS min FROM v1) FULL OUTER JOIN (SELECT MAX(i) AS max FROM v1) ON min = max;
