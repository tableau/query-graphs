-- Correlated EXISTS lowered to a magic set: operators are shared between the
-- magic groupBy and the semi-join, so pipelines have multiple dependencies.
SET global.share_forking=true;
SET global.view_inlining_selectivity_threshold=1;
CREATE TEMPORARY TABLE pipeline_magic_l (a int);
CREATE TEMPORARY TABLE pipeline_magic_r (c int, d int);
SELECT * FROM pipeline_magic_l WHERE EXISTS (SELECT 1 FROM pipeline_magic_r WHERE pipeline_magic_l.a > pipeline_magic_r.d GROUP BY pipeline_magic_r.c HAVING COUNT(*) > 0);
DROP TABLE pipeline_magic_l;
DROP TABLE pipeline_magic_r;
SET global.share_forking=true;
SET global.view_inlining_selectivity_threshold=0.5;
