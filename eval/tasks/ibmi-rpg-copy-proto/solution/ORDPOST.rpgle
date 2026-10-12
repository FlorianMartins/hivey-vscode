**free
// Post an order, after checking the customer.
ctl-opt dftactgrp(*no) actgrp(*caller);

/copy CUSTCHK_H

dcl-s custno  char(10) inz('0000012345');
dcl-s status  char(1);
dcl-s credit  packed(11:2);

// Through the prototype: the compiler now checks the count, the order and the lengths.
callp CustomerCheck(custno: status: credit);
dsply ('status ' + status);

*inlr = *on;
