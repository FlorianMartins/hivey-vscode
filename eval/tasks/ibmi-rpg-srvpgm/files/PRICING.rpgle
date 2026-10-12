**free
// Pricing rules. Also pasted into ORDENT, INVPRT and CRDNOT.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-c VAT_RATE 0.21;

dcl-s net   packed(11:2) inz(100.00);
dcl-s vat   packed(11:2);
dcl-s gross packed(11:2);

vat = net * VAT_RATE;
vat = %dec(vat + 0.005: 11: 2);
gross = net + vat;

dsply (%char(gross));

*inlr = *on;
