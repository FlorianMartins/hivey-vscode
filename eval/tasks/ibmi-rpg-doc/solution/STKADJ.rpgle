**free
// STKADJ — stock adjustments.
//
// What it is for: the two operations every program that moves stock needs, in one place, so that
// the rule "stock may not go negative" is enforced once rather than remembered four times.
//
// What calls it: ORDENT (on despatch), STKRCV (on goods-in) and STKCNT (on an inventory count).
// It is a service program with no entry point; callers call the procedures.
//
// Files: STKMAST, keyed, read AND updated — adjustStock writes to it. Nothing else is touched.
ctl-opt nomain;

dcl-f STKMAST keyed usage(*input: *update);

// Move the stock of one item by `delta`, which may be negative.
//
// Returns *OFF and changes nothing when the item does not exist, or when the move would take the
// balance below zero — the caller is expected to treat that as a refusal, not as an error.
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

// The current balance of one item, or zero when the item does not exist.
//
// Zero for "not found" is deliberate and is the caller's problem to know about: use adjustStock's
// return value, not this one, to decide whether an item exists.
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
