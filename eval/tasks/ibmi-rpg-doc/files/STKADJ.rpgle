**free
ctl-opt nomain;

dcl-f STKMAST keyed usage(*input: *update);

dcl-proc adjustStock export;
  dcl-pi *n ind;
    item char(15) const;
    delta packed(9:0) const;
  end-pi;

  chain (item) STKMAST;
  if not %found(STKMAST);
    return *off;
  endif;
  if STKQTY + delta < 0;
    return *off;
  endif;
  STKQTY = STKQTY + delta;
  update STKREC;
  return *on;
end-proc;

dcl-proc stockOf export;
  dcl-pi *n packed(9:0);
    item char(15) const;
  end-pi;

  chain (item) STKMAST;
  if not %found(STKMAST);
    return 0;
  endif;
  return STKQTY;
end-proc;
