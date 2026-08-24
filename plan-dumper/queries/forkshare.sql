-- MODES: pipelines
-- Forked share: the selective filter keeps the scan from being inlined, so it
-- becomes a shared scan. Its two consumers (the MIN and MAX pipelines) are
-- independent, so the share is forked and its scan recurs across both pipelines.
WITH v AS (SELECT a1 FROM t1 WHERE b1 < 5) SELECT * FROM (SELECT MIN(a1) AS mn FROM v) FULL OUTER JOIN (SELECT MAX(a1) AS mx FROM v) ON mn = mx;
