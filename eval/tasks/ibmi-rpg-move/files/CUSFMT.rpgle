**free
// Format a customer for the extract file.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s fullName  char(30) inz('DURAND');
dcl-s shortName char(10);
dcl-s codeIn    char(6)  inz('AB12');
dcl-s rightCode char(10);
dcl-s amount    packed(11:2) inz(1234.56);
dcl-s amountTxt char(15);

// MOVEL takes from the left. MOVE takes from the right. Which one this needed was decided in 1994.
movel fullName shortName;
move  codeIn   rightCode;
move  amount   amountTxt;

dsply (shortName + '|' + rightCode + '|' + amountTxt);

*inlr = *on;
