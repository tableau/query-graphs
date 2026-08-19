-- The same shared CTE as pipelines-forkshare, but with share forking disabled, so
-- the share is materialized: the shared scan feeds a temp that both aggregates
-- read, and the pipeline breaks at the materialization instead of the scan
-- recurring across pipelines.
SET global.share_forking=false;
SET global.view_inlining_selectivity_threshold=1;
CREATE TEMPORARY TABLE pipeline_graph_t (i int);
WITH v1 AS (SELECT i FROM pipeline_graph_t) SELECT * FROM (SELECT MIN(i) AS min FROM v1) FULL OUTER JOIN (SELECT MAX(i) AS max FROM v1) ON min = max;
DROP TABLE pipeline_graph_t;
SET global.share_forking=true;
SET global.view_inlining_selectivity_threshold=0.5;
