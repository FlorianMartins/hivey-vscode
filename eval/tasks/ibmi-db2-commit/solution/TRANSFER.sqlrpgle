**free
// Move money between two accounts.
//
// Both halves under commitment control. Two independent statements are not a transfer: a failure
// between them leaves the money debited and never credited, and nothing in the program knows.
ctl-opt dftactgrp(*no) actgrp(*caller) commit(*chg);

dcl-s fromAcct char(10) inz('4010      ');
dcl-s toAcct   char(10) inz('4020      ');
dcl-s cents    packed(11:0) inz(125000);
dcl-s inError  ind inz(*off);

exec sql
  update ACCOUNT set BALANCE = BALANCE - :cents where ACCTNO = :fromAcct;
if sqlcode <> 0;
  inError = *on;
endif;

if not inError;
  exec sql
    update ACCOUNT set BALANCE = BALANCE + :cents where ACCTNO = :toAcct;
  if sqlcode <> 0;
    inError = *on;
  endif;
endif;

if inError;
  exec sql rollback;
else;
  exec sql commit;
endif;

*inlr = *on;
