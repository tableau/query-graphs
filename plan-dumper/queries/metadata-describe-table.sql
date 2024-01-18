SELECT c.relchecks, c.relkind, c.relhasindex, c.relhasrules, c.relhastriggers,
       false as relispartition, c.reltablespace,
       CASE WHEN c.reloftype = 0 THEN '' ELSE c.reloftype::pg_catalog.regtype::pg_catalog.text END,
       c.relpersistence
FROM pg_catalog.pg_class c
LEFT JOIN pg_catalog.pg_class tc ON (c.reltoastrelid = tc.oid)
WHERE c.oid = '12'
