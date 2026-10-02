**free
// Post an order, after checking the customer.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s custno  char(10) inz('0000012345');
dcl-s status  char(1);
dcl-s credit  packed(11:2);

// No prototype: nothing checks that CUSTCHK still takes these three, in this order, at these
// lengths. A change over there fails here at run time, in production, on a Friday.
call 'CUSTCHK';
  // parameters passed positionally by the compiler's old rules
dsply ('status ' + status);

*inlr = *on;
