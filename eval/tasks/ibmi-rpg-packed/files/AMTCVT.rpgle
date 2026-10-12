**free
// Convert an amount with a rate.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s amount   float(8)   inz(1234.56);
dcl-s rate     float(8)   inz(1.0825);
dcl-s converted zoned(11: 0);
dcl-s rounded  packed(11:2);

converted = amount * rate;
rounded = converted;

dsply ('converted ' + %char(rounded));

*inlr = *on;
