-- CUSTMAST as SQL DDL.
--
-- The unique DDS key becomes the primary key, which also makes the columns NOT NULL: DDS has no
-- null-capable fields unless ALWNULL says so, so every column carries NOT NULL rather than
-- inheriting SQL's default the other way round.
CREATE TABLE DEVCFC.CUSTMAST (
  CUSNO  CHAR(10)      NOT NULL,
  CUSNAM CHAR(30)      NOT NULL DEFAULT '',
  BRANCH CHAR(3)       NOT NULL DEFAULT '',
  STATUS CHAR(1)       NOT NULL DEFAULT '',
  CUSBAL DECIMAL(11,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (CUSNO)
);

LABEL ON TABLE DEVCFC.CUSTMAST IS 'Customer master';

LABEL ON COLUMN DEVCFC.CUSTMAST (
  CUSNO  IS 'Customer number',
  CUSNAM IS 'Customer name',
  BRANCH IS 'Branch code',
  STATUS IS 'A=active, C=closed',
  CUSBAL IS 'Balance'
);
