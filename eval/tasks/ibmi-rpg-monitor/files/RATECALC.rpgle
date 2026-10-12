**free
// Unit rate for an order line.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s amount   packed(11:2) inz(1250.00);
dcl-s quantity packed(7:0)  inz(0);
dcl-s unitRate packed(11:4);
dcl-s inError  ind inz(*off);

unitRate = amount / quantity;

dsply ('rate: ' + %char(unitRate));

*inlr = *on;
