**free
// Convert an amount with a rate.
//
// Every monetary value is PACKED, and its precision is stated rather than inherited:
//
//   amount    packed(11:2)  — an amount in the ledger's currency, to the cent.
//   rate      packed(9:6)   — six decimals, which is what the rate feed publishes.
//   product   packed(19:8)  — the intermediate. 11+9 digits of operands cannot fit in 11, and a
//                             product that overflows is a value RPG truncates without saying so.
//   converted packed(11:2)  — the result, rounded once, at the end.
//
// A float was carrying money. A float cannot hold 0.10, so the cents drift, and a zoned(11:0) threw
// the decimals away entirely.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s amount    packed(11:2) inz(1234.56);
dcl-s rate      packed(9:6)  inz(1.082500);
dcl-s product   packed(19:8);
dcl-s converted packed(11:2);
dcl-s inError   ind inz(*off);

// A product that does not fit, or a rate of zero from a feed that failed, ends the program without
// this. The handler says what happened instead of leaving it to the job log.
monitor;
  product = amount * rate;
  // Rounded once, here, and half away from zero the way an invoice rounds.
  if product >= 0;
    converted = %dec(product + 0.005: 11: 2);
  else;
    converted = %dec(product - 0.005: 11: 2);
  endif;
on-error;
  inError = *on;
  converted = 0;
endmon;

if inError;
  dsply ('the amount could not be converted');
else;
  dsply ('converted ' + %char(converted));
endif;

*inlr = *on;
