-- The columns of DEVCFC/ORDHDR, as the table declares them.
--
-- QSYS2.SYSCOLUMNS rather than DSPFFD: a catalogue view can be joined, filtered and re-run by
-- anybody with SQL, and it is the same answer the database itself uses.
SELECT COLUMN_NAME,
       DATA_TYPE,
       LENGTH,
       NUMERIC_SCALE,
       IS_NULLABLE,
       COLUMN_TEXT
  FROM QSYS2.SYSCOLUMNS
 WHERE TABLE_SCHEMA = 'DEVCFC'
   AND TABLE_NAME   = 'ORDHDR'
 ORDER BY ORDINAL_POSITION;
