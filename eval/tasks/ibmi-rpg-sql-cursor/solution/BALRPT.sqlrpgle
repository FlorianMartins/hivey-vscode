**free
// Total the balances of one branch.
//
// One query instead of one trip per record. The loop was not slow because RPG is slow; it was slow
// because it crossed the boundary into the database once per customer, and the database could have
// done the whole thing in one pass.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s wantBranch char(3) inz('075');
dcl-s oneBalance packed(11:2);
dcl-s total      packed(13:2);

exec sql
  declare customers cursor for
    select CUSBAL from CUSTMAST where BRANCH = :wantBranch;

exec sql open customers;
if sqlcode < 0;
  dsply ('could not open the cursor');
  *inlr = *on;
  return;
endif;

dow sqlcode = 0;
  exec sql fetch customers into :oneBalance;
  // 100 is the end of the set, and it is not an error. A negative sqlcode is.
  if sqlcode <> 0;
    leave;
  endif;
  total = total + oneBalance;
enddo;

// Closed on every path out, including the error path above.
exec sql close customers;

dsply ('total ' + %char(total));

*inlr = *on;
