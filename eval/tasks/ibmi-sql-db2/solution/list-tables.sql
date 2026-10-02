-- Db2 for i keeps its catalogue in QSYS2, and the row counts live with the table statistics.
-- There is no information_schema and nothing from PostgreSQL's pg_* views.
SELECT TABLE_NAME, NUMBER_ROWS AS ROWS
  FROM QSYS2.SYSTABLESTAT
 WHERE TABLE_SCHEMA = 'SALESLIB'
 ORDER BY NUMBER_ROWS DESC;
