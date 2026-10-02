**free
// Format a customer for the extract file.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s fullName  char(30) inz('DURAND');
dcl-s shortName char(10);
dcl-s codeIn    char(6)  inz('AB12');
dcl-s rightCode char(10);
dcl-s amount    packed(11:2) inz(1234.56);
dcl-s amountTxt char(15);

// The alignment is now written down rather than implied by which of two operations was chosen.
// MOVEL took from the left: the first 10 characters.
shortName = %subst(fullName: 1: %len(shortName));
// MOVE took from the right: the value right-aligned in the longer field.
evalr rightCode = %trimr(codeIn);
evalr amountTxt = %char(amount);

dsply (shortName + '|' + rightCode + '|' + amountTxt);

*inlr = *on;
