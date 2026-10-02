**free
// Total the balances of one branch.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-f CUSTMAST keyed usage(*input);

dcl-s wantBranch char(3) inz('075');
dcl-s total      packed(13:2);

setll (wantBranch) CUSTMAST;
reade (wantBranch) CUSTMAST;
dow not %eof(CUSTMAST);
  total = total + CUSBAL;
  reade (wantBranch) CUSTMAST;
enddo;

dsply ('total ' + %char(total));

*inlr = *on;
