**free
// Unit rate for an order line.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s amount   packed(11:2) inz(1250.00);
dcl-s quantity packed(7:0)  inz(0);
dcl-s unitRate packed(11:4);
dcl-s inError  ind inz(*off);

// A MONITOR group around the statement that can fail, rather than a *PSSR for the whole program:
// the handler is next to the operation it covers, and it says what the result should be when the
// operation cannot be done. A *PSSR catches everything and knows nothing about where it was.
monitor;
  unitRate = amount / quantity;
on-error;
  unitRate = 0;
  inError = *on;
endmon;

if inError;
  dsply ('rate could not be computed');
else;
  dsply ('rate: ' + %char(unitRate));
endif;

*inlr = *on;
