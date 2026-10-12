**free
// Pricing rules, as a service program.
//
// NOMAIN: there is no program entry point, because nothing calls "the pricing program" — callers
// call a procedure in it. That is the difference between a service program and a program, and it is
// also what lets the rules be bound once and shared rather than copied four times.
ctl-opt nomain option(*srcstmt: *nodebugio);

/copy PRICING_H

dcl-c VAT_RATE 0.21;

dcl-proc CalcVat export;
  dcl-pi *n packed(11:2);
    net packed(11:2) const;
  end-pi;
  dcl-s vat packed(11:2);

  vat = net * VAT_RATE;
  vat = %dec(vat + 0.005: 11: 2);
  if vat < 0;
    vat = %dec(vat - 0.01: 11: 2);
  endif;
  return vat;
end-proc;

dcl-proc CalcGross export;
  dcl-pi *n packed(11:2);
    net packed(11:2) const;
  end-pi;
  return net + CalcVat(net);
end-proc;
