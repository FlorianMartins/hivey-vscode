**free
// VAT, to the cent, rounded half away from zero in both directions.
ctl-opt nomain;

dcl-c VAT_RATE 0.21;

dcl-proc calcVat export;
  dcl-pi *n packed(11:2);
    net packed(11:2) const;
  end-pi;
  dcl-s vat packed(11:2);

  vat = net * VAT_RATE;
  if vat >= 0;
    vat = %dec(vat + 0.005: 11: 2);
  else;
    vat = %dec(vat - 0.005: 11: 2);
  endif;
  return vat;
end-proc;
