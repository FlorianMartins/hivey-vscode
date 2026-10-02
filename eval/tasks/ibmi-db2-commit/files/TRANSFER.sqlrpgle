**free
// Move money between two accounts.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s fromAcct char(10) inz('4010      ');
dcl-s toAcct   char(10) inz('4020      ');
dcl-s cents    packed(11:0) inz(125000);
dcl-s inError  ind inz(*off);

exec sql
  update ACCOUNT set BALANCE = BALANCE - :cents where ACCTNO = :fromAcct;

exec sql
  update ACCOUNT set BALANCE = BALANCE + :cents where ACCTNO = :toAcct;

*inlr = *on;
