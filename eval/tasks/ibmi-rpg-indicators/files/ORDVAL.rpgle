**free
// Validate an order line.
ctl-opt dftactgrp(*no) actgrp(*caller);

dcl-s qty      packed(7:0);
dcl-s price    packed(11:2);
dcl-s custno   char(10);

// *IN03 comes from the display file: F3 is DDS's indicator, not ours.
dcl-s exitKey  ind;

qty = 0;
price = -1;
custno = '          ';

*in50 = *off;
*in51 = *off;
*in60 = *off;

if qty <= 0;
  *in50 = *on;
endif;
if price < 0;
  *in51 = *on;
endif;
if custno = *blanks;
  *in60 = *on;
endif;

if *in50 or *in51 or *in60;
  dsply ('order line refused');
else;
  dsply ('order line accepted');
endif;

if *in03;
  *inlr = *on;
  return;
endif;

*inlr = *on;
