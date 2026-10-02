**free
// Invoice totals.
ctl-opt dftactgrp(*no) actgrp(*caller) option(*srcstmt: *nodebugio);

dcl-s netAmt    packed(11:2);
dcl-s vatAmt    packed(11:2);
dcl-s grossAmt  packed(11:2);
dcl-s lineNet   packed(11:2);
dcl-s lineVat   packed(11:2);
dcl-s hdrNet    packed(11:2);
dcl-s hdrVat    packed(11:2);

dcl-pr calcVat packed(11:2);
  net packed(11:2) const;
end-pr;

lineNet = 100.00;
lineVat = calcVat(lineNet);

hdrNet = 250.00;
hdrVat = calcVat(hdrNet);

netAmt = -40.00;
vatAmt = calcVat(netAmt);

grossAmt = netAmt + vatAmt;

*inlr = *on;
return;

// One copy, so the correction for negative amounts cannot be present in two places and absent
// from the third — which is what had already happened to the credit note.
dcl-proc calcVat;
  dcl-pi *n packed(11:2);
    net packed(11:2) const;
  end-pi;

  dcl-c VAT_RATE 0.21;
  dcl-s vat packed(11:2);

  vat = net * VAT_RATE;
  vat = %dec(vat + 0.005: 11: 2);
  if vat < 0;
    vat = %dec(vat - 0.01: 11: 2);
  endif;
  return vat;
end-proc;
