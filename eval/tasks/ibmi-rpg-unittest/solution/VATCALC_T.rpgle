**free
// RPGUnit tests for VATCALC.
//
// One procedure per case, exported, named test… — that is how RUCALLTST finds them. The cases are
// the ones that separate a correct implementation from a plausible one: the half cent in BOTH
// directions, because rounding a credit note towards zero is the defect nobody sees on an invoice.
ctl-opt nomain;

/copy VATCALC_H

dcl-pr assert extpgm('RUASSERT');
  condition ind const;
  message varchar(200) const options(*nopass);
end-pr;

dcl-proc testOrdinaryInvoice export;
  // 100.00 at 21 % is 21.00, with nothing to round.
  assert(calcVat(100.00) = 21.00: 'ordinary invoice');
end-proc;

dcl-proc testHalfCentRoundsUp export;
  // 0.50 × 0.21 = 0.105, which must become 0.11 and not 0.10.
  assert(calcVat(0.50) = 0.11: 'half a cent rounds away from zero');
end-proc;

dcl-proc testHalfCentOnACreditRoundsDown export;
  // The same amount as a credit note: -0.105 must become -0.11, so that a refund matches the
  // invoice that charged it. This is the case a positive-only test suite never finds.
  assert(calcVat(-0.50) = -0.11: 'a negative half cent also rounds away from zero');
end-proc;

dcl-proc testZeroIsZero export;
  assert(calcVat(0) = 0: 'no net, no VAT');
end-proc;
